module.exports = async ({ github, context, core }) => {
const fs = require("fs");

const fail = message => {
  throw new Error(message);
};

const stageName = process.env.STAGE_NAME;
const agentName = process.env.AGENT_NAME;
const pullNumber = String(process.env.PULL_NUMBER ?? "").trim();
const specKitPhaseAgent = String(process.env.SPECKIT_PHASE_AGENT ?? "").trim();
const contextSource = String(process.env.CONTEXT_SOURCE ?? "safe-output").trim();
const directMode = contextSource === "direct";

let itemPullNumber;
let featureIssueNumber;
let specDirectory;
let primaryArtefact;
let taskIssueNumber = "";
let featurePRNumberDirect = "";

if (contextSource === "safe-output") {
  // ── Staged-mode early exit ──────────────────────────────────────────
  if (process.env.GH_AW_SAFE_OUTPUTS_STAGED === "true") {
    core.info(`Staged mode enabled; skipping ${stageName} agent assignment workaround.`);
    return;
  }

  // ── Token presence check ────────────────────────────────────────────
  if (!process.env.GH_AW_AGENT_TOKEN) {
    fail(`GH_AW_AGENT_TOKEN secret is not configured. The ${stageName} assignment workaround requires a PAT for Copilot agent assignment.`);
  }

  // ── Safe-output file read + JSON parse ──────────────────────────────
  const outputPath = process.env.GH_AW_AGENT_OUTPUT;
  if (!outputPath || !fs.existsSync(outputPath)) {
    fail(`GH_AW_AGENT_OUTPUT is not available for the ${stageName} assignment workaround.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch (error) {
    fail(`Failed to parse GH_AW_AGENT_OUTPUT for the ${stageName} assignment workaround: ${error instanceof Error ? error.message : String(error)}.`);
  }

  // ── Item filter + count guard ───────────────────────────────────────
  const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
  const itemType = `assign_${stageName}_agent_workaround`;
  const items = parsedItems.filter(item => item.type === itemType);

  if (items.length === 0) {
    core.info(`No ${itemType} requests found.`);
    return;
  }

  if (items.length > 1) {
    fail(`Expected exactly one ${itemType} request, found ${items.length}.`);
  }

  // gh aw does not populate ${{ inputs.X }} in safe-output jobs, so
  // read all dynamic values directly from the agent output item.
  featureIssueNumber = String(items[0].feature_issue_number ?? "").trim();
  specDirectory = String(items[0].spec_directory ?? "").trim();
  const stageArtefact = stageName === "refine" ? "spec.md" : stageName === "tasks" ? "tasks.md" : "plan.md";
  primaryArtefact = specDirectory ? `${specDirectory}/${stageArtefact}` : "";

  // ── PR number match guard ───────────────────────────────────────────
  itemPullNumber = String(items[0].pull_number ?? "").trim();
  if (!/^[1-9]\d*$/.test(itemPullNumber)) {
    fail(`Invalid pull_number for ${stageName} agent assignment: ${JSON.stringify(items[0].pull_number)}.`);
  }

  const expectedPullNumber = pullNumber || String(context.issue.number ?? "").trim();
  if (!expectedPullNumber) {
    fail("The triggering PR number is not available.");
  }
  if (itemPullNumber !== expectedPullNumber) {
    fail(`${itemType} must target the triggering PR #${expectedPullNumber}, received #${itemPullNumber}.`);
  }

  if (!/^[1-9]\d*$/.test(featureIssueNumber)) {
    fail(`Invalid feature_issue_number for ${stageName} agent assignment: ${JSON.stringify(featureIssueNumber)}.`);
  }

  if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) {
    fail(`Invalid spec_directory for ${stageName} agent assignment: ${JSON.stringify(specDirectory)}.`);
  }
} else {
  // ── Direct mode: all context provided via inputs ────────────────────
  const pullNumberFromInput = String(process.env.PULL_NUMBER ?? "").trim();
  featureIssueNumber = String(process.env.FEATURE_ISSUE_NUMBER_DIRECT ?? "").trim();
  specDirectory = String(process.env.SPEC_DIRECTORY_DIRECT ?? "").trim();
  taskIssueNumber = String(process.env.TASK_ISSUE_NUMBER_DIRECT ?? "").trim();
  featurePRNumberDirect = String(process.env.FEATURE_PR_NUMBER_DIRECT ?? "").trim();

  if (!/^[1-9]\d*$/.test(pullNumberFromInput)) fail(`Invalid pull-number for ${stageName}: ${JSON.stringify(pullNumberFromInput)}`);
  if (!/^[1-9]\d*$/.test(featureIssueNumber)) fail(`Invalid feature-issue-number for ${stageName}: ${JSON.stringify(featureIssueNumber)}`);
  if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) fail(`Invalid spec-directory for ${stageName}: ${JSON.stringify(specDirectory)}`);
  if (stageName !== 'review' && !/^[1-9]\d*$/.test(taskIssueNumber)) fail(`Invalid task-issue-number for ${stageName}: ${JSON.stringify(taskIssueNumber)}`);

  // Set variables to match what safe-output mode would have produced
  itemPullNumber = pullNumberFromInput;
  primaryArtefact = "";
}

const owner = context.repo.owner;
const repo = context.repo.repo;
const pullNumberInt = Number(itemPullNumber);

// ── GraphQL query for PR + Copilot assignee ID ─────────────────────
const query = `
  query($owner: String!, $repo: String!, $pullNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      suggestedActors(first: 100, capabilities: CAN_BE_ASSIGNED) {
        nodes {
          ... on Bot {
            __typename
            id
            login
          }
          ... on User {
            __typename
            id
            login
          }
        }
      }
      pullRequest(number: $pullNumber) {
        id
        baseRefName
        headRefName
        assignees(first: 100) {
          nodes {
            id
            login
          }
        }
      }
    }
  }
`;

const response = await github.graphql(query, { owner, repo, pullNumber: pullNumberInt });

const pullRequest = response.repository?.pullRequest;
if (!pullRequest?.id) {
  fail(`Pull request #${itemPullNumber} was not found in ${owner}/${repo}.`);
}

const baseRefName = String(pullRequest.baseRefName ?? "").trim();
if (!baseRefName) {
  fail(`Base branch could not be determined for PR #${itemPullNumber}.`);
}

const headRefName = String(pullRequest.headRefName ?? "").trim();
if (!headRefName) {
  fail(`Head branch could not be determined for PR #${itemPullNumber}.`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isCopilotLogin = login => typeof login === "string" && /^(copilot|copilot-swe-agent)(\[bot\])?$/i.test(login.trim());

const agent = (response.repository?.suggestedActors?.nodes || []).find(actor => isCopilotLogin(actor?.login));
if (!agent?.id) {
  fail("Copilot coding agent is not available as an assignee for this repository.");
}

// ── waitForCopilotAssignment polling loop ───────────────────────────
const waitForCopilotAssignment = async ({ timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pull = await github.rest.pulls.get({ owner, repo, pull_number: pullNumberInt });
    const assignees = Array.isArray(pull.data?.assignees) ? pull.data.assignees : [];
    if (assignees.some(assignee => isCopilotLogin(assignee?.login))) {
      return;
    }
    await sleep(2000);
  }
  fail(`Copilot did not appear as an assignee on PR #${itemPullNumber} after the ${stageName} assignment update.`);
};

// ── waitForCopilotUnassignment polling loop ─────────────────────────
const waitForCopilotUnassignment = async ({ timeoutMs }) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pull = await github.rest.pulls.get({ owner, repo, pull_number: pullNumberInt });
    const assignees = Array.isArray(pull.data?.assignees) ? pull.data.assignees : [];
    if (!assignees.some(assignee => isCopilotLogin(assignee?.login))) {
      return;
    }
    await sleep(2000);
  }
  fail(`Copilot remained assigned to PR #${itemPullNumber} after the ${stageName} reassignment reset step.`);
};

// ── Startup comment body (parameterised by stage-name) ──────────────
let firstLine;
let contextPhase;
let contextRunMode;
let agentHeader;
let instructions;
let additionalContextFields = [];
let stageTaskField = "";
let stageIssueRef = "";
let stageIssueLabel = "";

if (stageName === "plan") {
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to generate \`${primaryArtefact}\` for this pull request from \`${specDirectory}/spec.md\`, commit the result to \`${headRefName}\`, and post your completion summary using the **PR Summary Format** from your agent instructions (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`;
  contextPhase = "plan";
  contextRunMode = "generate";
  agentHeader = "Plan Agent — Startup Instructions";
  additionalContextFields = [
    `Analyze agent: .github/agents/speckit.analyze.agent.md`,
  ];
  instructions = [
    `1. Read \`${specDirectory}/spec.md\` in full.`,
    `2. Use the speckit.plan agent (or equivalent plan template) to generate \`${primaryArtefact}\` and any required plan-stage supporting artefacts.`,
    "3. Ensure the plan covers every functional requirement and success criterion in `spec.md`.",
    `4. Commit and push the updated plan-stage artefacts to the PR branch \`${headRefName}\`.`,
    `5. Post a summary comment on PR #${itemPullNumber} using the **PR Summary Format** from your \`agentic-flow-plan\` agent instructions. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block exactly as specified — this is machine-critical for the next pipeline phase.`,
  ].join("\n");
} else if (stageName === "refine") {
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to refine \`${primaryArtefact}\` for this pull request using the latest PR feedback, commit the updated spec to \`${headRefName}\`, and post your completion summary using the **PR Summary Format** from your agent instructions (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`;
  contextPhase = "spec";
  contextRunMode = "refine";
  agentHeader = "Refine Spec Agent — Startup Instructions";
  additionalContextFields = [
    `Clarify agent: .github/agents/speckit.clarify.agent.md`,
    `Analyze agent: .github/agents/speckit.analyze.agent.md`,
  ];
  instructions = [
    `1. Read \`${primaryArtefact}\`, the current PR description, and the latest unresolved PR comments and reviews in full.`,
    `2. Use the speckit.specify, speckit.clarify, and speckit.analyze agents (or equivalent templates) to refine \`${primaryArtefact}\` and any required spec-stage supporting artefacts in place.`,
    `3. Keep all work on the existing branch \`${headRefName}\`. Do not create a new branch or PR.`,
    `4. Commit and push the updated spec-stage artefacts to \`${headRefName}\`.`,
    `5. Post a summary comment on PR #${itemPullNumber} using the **PR Summary Format** from your \`agentic-flow-spec\` agent instructions (refine mode). The comment MUST include the \`<!-- agentic-flow-context ... -->\` block exactly as specified — this is machine-critical for the next pipeline phase.`,
  ].join("\n");
} else if (stageName === "tasks") {
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to generate \`${primaryArtefact}\` for this pull request from the approved design artefacts in \`${specDirectory}\`, commit the result to \`${headRefName}\`, and post your completion summary using the **PR Summary Format** from your agent instructions (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`;
  contextPhase = "tasks";
  contextRunMode = "generate";
  agentHeader = "Tasks Agent — Startup Instructions";
  additionalContextFields = [
    `Analyze agent: .github/agents/speckit.analyze.agent.md`,
    `Checklist agent: .github/agents/speckit.checklist.agent.md`,
  ];
  instructions = [
    `1. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and any existing design artefacts in \`${specDirectory}\` in full.`,
    `2. Use the speckit.tasks, speckit.analyze, and speckit.checklist agents (or equivalent templates) to generate \`${primaryArtefact}\` and any required tasks-stage supporting artefacts.`,
    `3. Keep all work on the existing branch \`${headRefName}\`. Do not create a new branch or PR.`,
    `4. Commit and push the updated tasks-stage artefacts to \`${headRefName}\`.`,
    `5. Post a summary comment on PR #${itemPullNumber} using the **PR Summary Format** from your \`agentic-flow-tasks\` agent instructions. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block exactly as specified — this is machine-critical for post-merge sub-issue creation.`,
  ].join("\n");
} else if (stageName === "implement") {
  stageIssueRef = directMode ? taskIssueNumber : "";
  stageIssueLabel = "Task issue";
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to implement the task described in issue #${stageIssueRef} on branch \`${headRefName}\` and post your completion summary when done (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`;
  contextPhase = "implement";
  contextRunMode = "implement";
  agentHeader = "Implementation Agent — Startup Instructions";
  stageTaskField = `Task issue: #${stageIssueRef}`;
  instructions = [
    `1. Read the task issue #${stageIssueRef} body in full — it describes exactly what to implement.`,
    `2. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` for full feature context.`,
    `3. Read the current state of the feature branch (\`${baseRefName}\`) to understand what has already been implemented.`,
    `4. Implement the task on branch \`${headRefName}\`. Use \`create_or_update_file\` to commit all changes — do NOT use \`git push\`.`,
    `5. Post an implementation summary on this PR. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block.`,
    `6. Apply the \`ready-to-merge-task\` label to this PR to signal completion.`,
  ].join("\n");
} else if (stageName === "audit") {
  stageIssueRef = directMode ? taskIssueNumber : "";
  stageIssueLabel = "Audit task issue";
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to perform the audit described in issue #${stageIssueRef} on this feature PR and post your review when done.`;
  contextPhase = "audit";
  contextRunMode = "audit";
  agentHeader = "Audit Agent — Startup Instructions";
  stageTaskField = `Audit task issue: #${stageIssueRef}`;
  instructions = [
    `1. Read the audit task issue #${stageIssueRef} body — it describes exactly what to validate.`,
    `2. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` for full feature context.`,
    `3. Fetch and review the complete diff of this feature PR (all files changed across all implementation tasks).`,
    `4. Perform the audit/validation described in the audit task issue.`,
    `5. Post a formal PR review (\`APPROVE\` or \`REQUEST_CHANGES\`) with detailed findings.`,
    `6. Update issue #${stageIssueRef} with a validation summary, then close the issue if all checks pass.`,
    `7. Post a context comment on this PR with the \`<!-- agentic-flow-context ... -->\` block.`,
  ].join("\n");
} else if (stageName === "review") {
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to perform a four-category cross-cutting review of this feature PR and post your review findings when done.`;
  contextPhase = "review";
  contextRunMode = "review";
  agentHeader = "Review Agent — Startup Instructions";
  instructions = [
    `1. Read the most recent \`<!-- agentic-flow-context\` comment on this PR (Phase: review) to confirm context.`,
    `2. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` for full feature context (if \`tasks.md\` is absent, note it in the coverage check rather than failing).`,
    `3. Fetch and review the complete diff of this feature PR: \`git fetch origin && git diff origin/main...origin/${headRefName}\`.`,
    `4. Perform four cross-cutting checks: (a) **Security**: hardcoded credentials/secrets, unsafe user-input handling, injection-pattern anti-patterns, vulnerable dependency versions; (b) **Architecture**: adherence to all decisions in \`plan.md\`, absence of unintended coupling, naming/structural consistency; (c) **Acceptance Criteria**: confirm every criterion in \`spec.md\` has a corresponding implementation or test — list each unmet criterion individually; (d) **Coverage**: test presence for critical paths in \`tasks.md\` and obvious untested branches in new code.`,
    `5. If APPROVE: post a findings summary comment on this PR, then call \`create_pull_request_review\` with \`event: "APPROVE"\`, then post the \`<!-- agentic-flow-context Phase: review ... Audit result: APPROVE -->\` context block comment on this PR.`,
    `6. If REQUEST_CHANGES: post a structured findings comment organised by category (each finding includes: category, file path, description, remediation guidance), then call \`create_pull_request_review\` with \`event: "REQUEST_CHANGES"\`, then post the context block comment with \`Audit result: REQUEST_CHANGES\`.`,
    `7. **Completion gate** (mandatory — do not skip): call \`list_issue_comments\` on this PR and verify a comment exists containing \`<!-- agentic-flow-context\`, \`Phase: review\`, and \`Audit result:\`. If not found, post the context block now, then re-verify.`,
  ].join("\n");
} else if (stageName === "review-fix") {
  stageIssueRef = directMode ? featurePRNumberDirect : "";
  stageIssueLabel = "Feature PR";
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to implement the review fixes described in the findings comment on feature PR #${stageIssueRef} and post your completion summary when done (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`;
  contextPhase = "review-fix";
  contextRunMode = "review-fix";
  agentHeader = "Review Fix Agent — Startup Instructions";
  instructions = [
    `1. Read the findings comment on feature PR #${stageIssueRef} — it describes the review findings that must be addressed. The findings comment is the most recent bot comment on that PR that does NOT contain \`<!-- agentic-flow-context\`.`,
    `2. Read this fix PR body for additional context on the fix scope.`,
    `3. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` for full feature context.`,
    `4. Read the current state of the feature branch (\`${baseRefName}\`) to understand what has already been implemented.`,
    `5. Implement all fixes on branch \`${headRefName}\` to address the review findings. Use \`create_or_update_file\` to commit all changes — do NOT use \`git push\`.`,
    `6. Post an implementation summary on this PR. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block with \`Phase: review-fix\`.`,
    `7. Apply the \`ready-to-merge-task\` label to this PR to signal completion and trigger auto-merge.`,
  ].join("\n");
} else {
  fail(`Unknown stage-name: ${JSON.stringify(stageName)}. Must be plan | refine | tasks | implement | audit | review | review-fix.`);
}

const contextBlock = [
  "<!-- agentic-flow-context",
  `Phase: ${contextPhase}`,
  `Run mode: ${contextRunMode}`,
  `Feature issue: #${featureIssueNumber}`,
  `Spec directory: ${specDirectory}`,
  ...(stageTaskField ? [stageTaskField] : []),
  ...(stageName === "implement" ? [
    `Feature branch: \`${baseRefName}\``,
    `Task branch: \`${headRefName}\``,
    ...(featurePRNumberDirect ? [`Feature PR: #${featurePRNumberDirect}`] : []),
  ] : []),
  ...(stageName === "audit" ? [
    `Feature PR: #${itemPullNumber}`,
    `Feature branch: \`${headRefName}\``,
  ] : []),
  ...(stageName === "review" ? [
    `Feature PR: #${itemPullNumber}`,
    `Feature branch: \`${headRefName}\``,
  ] : []),
  ...(stageName === "review-fix" ? [
    `Feature branch: \`${baseRefName}\``,
    `Fix branch: \`${headRefName}\``,
    ...(featurePRNumberDirect ? [`Feature PR: #${featurePRNumberDirect}`] : []),
  ] : []),
  ...(primaryArtefact ? [`Primary artefact: ${primaryArtefact}`] : []),
  ...(specKitPhaseAgent ? [`Speckit phase agent: ${specKitPhaseAgent}`] : []),
  ...additionalContextFields,
  ...(stageName !== "implement" && stageName !== "audit" && stageName !== "review" && stageName !== "review-fix" ? ["Constitution: .specify/memory/constitution.md"] : []),
  "-->",
].join("\n");

const humanNote = stageName === "plan"
  ? `> [!IMPORTANT]\n> **👉 Next step for the human reviewer:** Once you have reviewed \`${primaryArtefact}\`, post **\`/approve-plan\`** as a comment on this PR to proceed to task generation. Do not execute that command yourself.`
  : stageName === "refine"
  ? `> [!IMPORTANT]\n> **👉 Next step for the human reviewer:** Review the updated \`${primaryArtefact}\`, then post **\`/approve-spec\`** to proceed to plan generation, or **\`/refine-spec\`** for another spec iteration. Do not execute those commands yourself.`
  : stageName === "tasks"
  ? `> [!IMPORTANT]\n> **👉 Next step for the human reviewer:** Review \`${primaryArtefact}\` in this PR. When satisfied, **merge this PR** to create the implementation task sub-issues. Do not merge the PR or trigger follow-up workflow actions yourself.`
  : stageName === "implement"
  ? `> This task PR will be **auto-merged** once CI checks pass. No human action required.`
  : stageName === "review"
  ? `> This feature PR review is automatic — no human action required until the review agent posts its result.`
  : stageName === "review-fix"
  ? `> This review fix task PR will be **auto-merged** once CI checks pass. No human action required.`
  : `> [!IMPORTANT]\n> **👉 Next step for the human reviewer:** Review the audit findings on this feature PR. If the audit requested changes, address them and post \`/rerun-audit\` as a comment to re-run the audit.`;

const sourceArtefactsRow = (stageName === "tasks" || stageName === "implement" || stageName === "audit" || stageName === "review" || stageName === "review-fix")
  ? `| Source artefacts | \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\` |`
  : `| Source artefact | \`${specDirectory}/spec.md\` |`;

const yourTaskLine = stageName === "plan"
  ? `**Your task**: Generate \`${primaryArtefact}\` — the structured implementation plan for this feature.`
  : stageName === "refine"
  ? `**Your task**: Generate \`${primaryArtefact}\` — the refined spec for this feature.`
  : stageName === "tasks"
  ? `**Your task**: Generate \`${primaryArtefact}\` — the dependency-ordered implementation task breakdown for this feature.`
  : stageName === "implement"
  ? `**Your task**: Implement the changes described in task issue #${stageIssueRef} on branch \`${headRefName}\`.`
  : stageName === "review"
  ? `**Your task**: Perform a four-category cross-cutting review (security, architecture, acceptance criteria, coverage) of this feature PR and post your findings.`
  : stageName === "review-fix"
  ? `**Your task**: Implement the review fixes described in the findings comment on feature PR #${stageIssueRef} on branch \`${headRefName}\`.`
  : `**Your task**: Perform the audit described in issue #${stageIssueRef} and review this feature PR.`;

const triggeredByLine = stageName === "implement"
  ? `Triggered by agentic-flow implementation pipeline for task #${stageIssueRef}`
  : stageName === "audit"
  ? `Triggered by agentic-flow audit pipeline for audit task #${stageIssueRef}`
  : stageName === "review"
  ? `Triggered by agentic-flow review pipeline for feature PR #${itemPullNumber}`
  : stageName === "review-fix"
  ? `Triggered by agentic-flow review fix pipeline for feature PR #${stageIssueRef}`
  : `Triggered by \`/${stageName === "plan" ? "approve-spec" : stageName === "refine" ? "refine-spec" : "approve-plan"}\` on PR #${itemPullNumber} — agentic-flow`;

const startupCommentBody = [
  firstLine,
  "",
  contextBlock,
  `## ${agentHeader}`,
  "",
  `You are the ${stageName} agent in the agentic-flow pipeline.`,
  "",
  yourTaskLine,
  "",
  "| Field | Value |",
  "| --- | --- |",
  `| Feature Issue | #${featureIssueNumber} |`,
  `| Spec PR | #${itemPullNumber} |`,
  `| Spec directory | \`${specDirectory}\` |`,
  ...(primaryArtefact ? [`| Primary artefact | \`${primaryArtefact}\` |`] : []),
  ...(stageIssueRef ? [`| ${stageIssueLabel} | #${stageIssueRef} |`] : []),
  sourceArtefactsRow,
  `| Feature branch | \`${headRefName}\` |`,
  "",
  "### Instructions",
  instructions,
  "",
  humanNote,
  "",
  triggeredByLine,
].join("\n");

core.info(`Generated ${stageName} startup comment body for PR #${itemPullNumber}.`);

const customInstructions = [
  `You are starting the agentic-flow ${stageName} phase for the current pull request.`,
  "Use the exact startup comment body below as the authoritative phase context for this assignment.",
  `The expected phase for this assignment is \`${contextPhase}\` with run mode \`${contextRunMode}\`.`,
  `This startup context was generated by the ${stageName} assignment workflow for the current run.`,
  "",
  "Use this exact startup comment:",
  startupCommentBody,
  "",
  `Generate only the ${stageName}-stage artefacts for the current PR branch.`,
].join("\n");

if (customInstructions.length > 8000) {
  fail(`${stageName} startup instructions are too large (${customInstructions.length} characters).`);
}

// ── getCurrentAssigneeIds helper ────────────────────────────────────
const getCurrentAssigneeIds = async () => {
  const latest = await github.graphql(
    `query($owner: String!, $repo: String!, $pullNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pullNumber) {
          assignees(first: 100) {
            nodes { id }
          }
        }
      }
    }`,
    { owner, repo, pullNumber: pullNumberInt }
  );
  return (latest.repository?.pullRequest?.assignees?.nodes || []).map(node => node?.id).filter(Boolean);
};

const initialAssigneeIds = await getCurrentAssigneeIds();
const copilotAlreadyAssigned = initialAssigneeIds.includes(agent.id);

// ── replaceActors mutation ──────────────────────────────────────────
const replaceActors = async ({ actorIds, customAgent = null, customInstructions: ci = null, baseRef = null }) => {
  const mutation = customAgent
    ? `mutation($assignableId: ID!, $actorIds: [ID!]!, $customAgent: String!, $customInstructions: String!, $baseRef: String!) {
        replaceActorsForAssignable(input: {
          assignableId: $assignableId,
          actorIds: $actorIds,
          agentAssignment: {
            customAgent: $customAgent
            customInstructions: $customInstructions
            baseRef: $baseRef
          }
        }) { __typename }
      }`
    : `mutation($assignableId: ID!, $actorIds: [ID!]!) {
        replaceActorsForAssignable(input: {
          assignableId: $assignableId,
          actorIds: $actorIds
        }) { __typename }
      }`;

  const result = await github.graphql(mutation, {
    assignableId: pullRequest.id,
    actorIds,
    ...(customAgent ? { customAgent, customInstructions: ci, baseRef } : {}),
    headers: { "GraphQL-Features": "issues_copilot_assignment_api_support" },
  });

  if (!result?.replaceActorsForAssignable?.__typename) {
    fail(`GitHub did not confirm the ${stageName} agent assignment update for PR #${itemPullNumber}.`);
  }
};

// ── addAssignees → post-comment → removeAssignees sequence ──────────
if (copilotAlreadyAssigned) {
  if (stageName === 'implement' || stageName === 'review-fix') {
    // Implement / review-fix: skip entirely — Copilot is actively coding; don't interrupt.
    core.info(`Copilot is already assigned to PR #${itemPullNumber} for ${stageName} stage; skipping to avoid interrupting the ongoing session.`);
    core.setOutput('startup-comment-id', '');
    return;
  }
  if (stageName === 'audit' || stageName === 'review') {
    // Audit / review: Copilot may already be assigned from a prior run on the same PR.
    // Don't re-assign (that would interrupt any ongoing session), but DO post the
    // startup comment so Copilot gets the new context.
    core.info(`Copilot is already assigned to PR #${itemPullNumber} for ${stageName} stage; posting startup comment without re-assigning.`);
    // Fall through to the startup comment step below.
  } else {
    // spec/plan/tasks: force fresh reassignment (new command = new session).
    core.info(`Copilot is already assigned to PR #${itemPullNumber}; forcing a fresh reassignment for the ${stageName} wrapper.`);
    await replaceActors({
      actorIds: (await getCurrentAssigneeIds()).filter(id => id !== agent.id),
    });
    await waitForCopilotUnassignment({ timeoutMs: 30000 });
  }
}

// Work around the upstream gh aw PR-target assignment bug by performing the PR
// reassignment directly. Also force a fresh reassignment when Copilot is already
// present and forward the exact startup comment body through customInstructions
// so the new session starts with explicit stage-specific context.
// Skip replaceActors for the audit/review stages when Copilot is already assigned —
// we only need the startup comment in that case (assignment was handled previously).
if (!(copilotAlreadyAssigned && (stageName === 'audit' || stageName === 'review'))) {
  const actorIds = [agent.id, ...(await getCurrentAssigneeIds()).filter(id => id !== agent.id)];
  await replaceActors({
    actorIds,
    customAgent: agentName,
    customInstructions,
    baseRef: baseRefName,
  });
  await waitForCopilotAssignment({ timeoutMs: 30000 });
  await sleep(5000);
}

const triggerComment = await github.rest.issues.createComment({
  owner,
  repo,
  issue_number: pullNumberInt,
  body: startupCommentBody,
});

if (!triggerComment?.data?.id) {
  fail(`GitHub did not confirm the ${stageName} trigger comment on PR #${itemPullNumber}.`);
}

core.info(`Posted ${stageName} trigger comment ${triggerComment.data.id} on PR #${itemPullNumber}.`);
core.info(`Assigned ${agentName} to PR #${itemPullNumber}.`);
core.setOutput("startup-comment-id", String(triggerComment.data.id));
};
