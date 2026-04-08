---
name: Tasks Agent (agentic-flow)
on:
  slash_command: approve-plan

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  add-comment: null
  jobs:
    assign-tasks-agent-workaround:
      description: Assign the triggering spec PR to the agentic-flow-tasks wrapper and post the generated startup comment.
      output: Tasks agent assignment requested.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        contents: read
        pull-requests: write
      inputs:
        pull_number:
          description: String form of the spec PR number that received /approve-plan. Must match the triggering PR.
          required: true
          type: string
        feature_issue_number:
          description: Numeric feature issue number extracted from the handoff context block.
          required: true
          type: string
        spec_directory:
          description: Spec directory extracted from the handoff context block.
          required: true
          type: string
      steps:
        - name: Assign agentic-flow-tasks wrapper
          uses: actions/github-script@v8
          env:
            GH_AW_AGENT_TOKEN: "${{ secrets.GH_AW_AGENT_TOKEN }}"
          with:
            github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
            script: |
              const fs = require("fs");

              const fail = message => {
                throw new Error(message);
              };

              if (process.env.GH_AW_SAFE_OUTPUTS_STAGED === "true") {
                core.info("Staged mode enabled; skipping tasks agent assignment workaround.");
                return;
              }

              if (!process.env.GH_AW_AGENT_TOKEN) {
                fail("GH_AW_AGENT_TOKEN secret is not configured. The tasks assignment workaround requires a PAT for Copilot agent assignment.");
              }

              const outputPath = process.env.GH_AW_AGENT_OUTPUT;
              if (!outputPath || !fs.existsSync(outputPath)) {
                fail("GH_AW_AGENT_OUTPUT is not available for the tasks assignment workaround.");
              }

              let parsed;
              try {
                parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
              } catch (error) {
                fail(`Failed to parse GH_AW_AGENT_OUTPUT for the tasks assignment workaround: ${error instanceof Error ? error.message : String(error)}.`);
              }

              const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
              const items = parsedItems.filter(item => item.type === "assign_tasks_agent_workaround");

              if (items.length === 0) {
                core.info("No assign_tasks_agent_workaround requests found.");
                return;
              }

              if (items.length > 1) {
                fail(`Expected exactly one assign_tasks_agent_workaround request, found ${items.length}.`);
              }

              const pullNumber = String(items[0].pull_number ?? "").trim();
              if (!/^[1-9]\d*$/.test(pullNumber)) {
                fail(`Invalid pull_number for tasks agent assignment: ${JSON.stringify(items[0].pull_number)}.`);
              }

              const expectedPullNumber = String(context.issue.number ?? "").trim();
              if (!expectedPullNumber) {
                fail("The triggering PR number is not available in github.context.issue.number.");
              }
              if (pullNumber !== expectedPullNumber) {
                fail(`assign_tasks_agent_workaround must target the triggering PR #${expectedPullNumber}, received #${pullNumber}.`);
              }

              const featureIssueNumber = String(items[0].feature_issue_number ?? "").trim();
              if (!/^[1-9]\d*$/.test(featureIssueNumber)) {
                fail(`Invalid feature_issue_number for tasks agent assignment: ${JSON.stringify(items[0].feature_issue_number)}.`);
              }

              const specDirectory = String(items[0].spec_directory ?? "").trim();
              if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) {
                fail(`Invalid spec_directory for tasks agent assignment: ${JSON.stringify(items[0].spec_directory)}.`);
              }

              const owner = context.repo.owner;
              const repo = context.repo.repo;
              const pullNumberInt = Number(pullNumber);

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

              const response = await github.graphql(query, {
                owner,
                repo,
                pullNumber: pullNumberInt,
              });

              const pullRequest = response.repository?.pullRequest;
              if (!pullRequest?.id) {
                fail(`Pull request #${pullNumber} was not found in ${owner}/${repo}.`);
              }

              const baseRefName = String(pullRequest.baseRefName ?? "").trim();
              if (!baseRefName) {
                fail(`Base branch could not be determined for PR #${pullNumber}.`);
              }

              const headRefName = String(pullRequest.headRefName ?? "").trim();
              if (!headRefName) {
                fail(`Head branch could not be determined for PR #${pullNumber}.`);
              }

              const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
              const isCopilotLogin = login => typeof login === "string" && /^(copilot|copilot-swe-agent)(\[bot\])?$/i.test(login.trim());

              const agent = (response.repository?.suggestedActors?.nodes || []).find(actor => isCopilotLogin(actor?.login));
              if (!agent?.id) {
                fail("Copilot coding agent is not available as an assignee for this repository.");
              }

              const waitForCopilotAssignment = async ({ timeoutMs }) => {
                const deadline = Date.now() + timeoutMs;

                while (Date.now() < deadline) {
                  const pull = await github.rest.pulls.get({
                    owner,
                    repo,
                    pull_number: pullNumberInt,
                  });

                  const assignees = Array.isArray(pull.data?.assignees) ? pull.data.assignees : [];
                  if (assignees.some(assignee => isCopilotLogin(assignee?.login))) {
                    return;
                  }

                  await sleep(2000);
                }

                fail(`Copilot did not appear as an assignee on PR #${pullNumber} after the tasks assignment update.`);
              };

              const waitForCopilotUnassignment = async ({ timeoutMs }) => {
                const deadline = Date.now() + timeoutMs;

                while (Date.now() < deadline) {
                  const pull = await github.rest.pulls.get({
                    owner,
                    repo,
                    pull_number: pullNumberInt,
                  });

                  const assignees = Array.isArray(pull.data?.assignees) ? pull.data.assignees : [];
                  if (!assignees.some(assignee => isCopilotLogin(assignee?.login))) {
                    return;
                  }

                  await sleep(2000);
                }

                fail(`Copilot remained assigned to PR #${pullNumber} after the tasks reassignment reset step.`);
              };

              const startupCommentBody = [
                `@copilot please use the already-assigned \`agentic-flow-tasks\` custom agent to generate \`${specDirectory}/tasks.md\` for this pull request from the approved design artefacts in \`${specDirectory}\`, commit the result to \`${headRefName}\`, and post a concise summary here.`,
                "",
                "<!-- agentic-flow-context",
                "Phase: tasks",
                "Run mode: generate",
                `Feature issue: #${featureIssueNumber}`,
                `Spec directory: ${specDirectory}`,
                `Primary artefact: ${specDirectory}/tasks.md`,
                "Speckit phase agent: .github/agents/speckit.tasks.agent.md",
                "Analyze agent: .github/agents/speckit.analyze.agent.md",
                "Checklist agent: .github/agents/speckit.checklist.agent.md",
                "Constitution: .specify/memory/constitution.md",
                "-->",
                "## Tasks Agent — Startup Instructions",
                "",
                "You are the tasks agent in the agentic-flow pipeline.",
                "",
                `**Your task**: Generate \`${specDirectory}/tasks.md\` — the dependency-ordered implementation task breakdown for this feature.`,
                "",
                "| Field | Value |",
                "| --- | --- |",
                `| Feature Issue | #${featureIssueNumber} |`,
                `| Spec PR | #${pullNumber} |`,
                `| Spec directory | \`${specDirectory}\` |`,
                `| Primary artefact | \`${specDirectory}/tasks.md\` |`,
                `| Source artefacts | \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\` |`,
                `| Feature branch | \`${headRefName}\` |`,
                "",
                "### Instructions",
                `1. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and any existing design artefacts in \`${specDirectory}\` in full.`,
                `2. Use the speckit.tasks, speckit.analyze, and speckit.checklist agents (or equivalent templates) to generate \`${specDirectory}/tasks.md\` and any required tasks-stage supporting artefacts.`,
                `3. Keep all work on the existing branch \`${headRefName}\`. Do not create a new branch or PR.`,
                `4. Commit and push the updated tasks-stage artefacts to \`${headRefName}\`.`,
                `5. If analyze and checklist both pass, apply the \`ready-to-merge\` label to PR #${pullNumber}.`,
                `6. Post a concise summary comment on PR #${pullNumber} with the task breakdown highlights and gate results.`,
                "",
                "**For the human reviewer**: after reviewing `tasks.md`, merge this PR when satisfied. Do not merge the PR or trigger follow-up workflow actions yourself.",
                "",
                `Triggered by \`/approve-plan\` on PR #${pullNumber} — agentic-flow`,
              ].join("\n");

              core.info(`Generated tasks startup comment body for PR #${pullNumber}.`);

              const customInstructions = [
                "You are starting the agentic-flow tasks phase for the current pull request.",
                "Use the exact startup comment body below as the authoritative phase context for this assignment.",
                "The expected phase for this assignment is `tasks` with run mode `generate`.",
                "This startup context was generated by the tasks assignment workflow for the current run.",
                "",
                "Use this exact startup comment:",
                startupCommentBody,
                "",
                "Generate only the tasks-stage artefacts for the current PR branch.",
              ].join("\n");

              if (customInstructions.length > 8000) {
                fail(`Tasks startup instructions are too large (${customInstructions.length} characters).`);
              }

              const getCurrentAssigneeIds = async () => {
                const latest = await github.graphql(
                  `
                    query($owner: String!, $repo: String!, $pullNumber: Int!) {
                      repository(owner: $owner, name: $repo) {
                        pullRequest(number: $pullNumber) {
                          assignees(first: 100) {
                            nodes {
                              id
                            }
                          }
                        }
                      }
                    }
                  `,
                  {
                    owner,
                    repo,
                    pullNumber: pullNumberInt,
                  }
                );

                return (latest.repository?.pullRequest?.assignees?.nodes || []).map(node => node?.id).filter(Boolean);
              };

              const initialAssigneeIds = await getCurrentAssigneeIds();
              const copilotAlreadyAssigned = initialAssigneeIds.includes(agent.id);

              const replaceActors = async ({ actorIds, customAgent = null, customInstructions = null, baseRef = null }) => {
                const mutation = customAgent
                  ? `
                      mutation($assignableId: ID!, $actorIds: [ID!]!, $customAgent: String!, $customInstructions: String!, $baseRef: String!) {
                        replaceActorsForAssignable(input: {
                          assignableId: $assignableId,
                          actorIds: $actorIds,
                          agentAssignment: {
                            customAgent: $customAgent
                            customInstructions: $customInstructions
                            baseRef: $baseRef
                          }
                        }) {
                          __typename
                        }
                      }
                    `
                  : `
                      mutation($assignableId: ID!, $actorIds: [ID!]!) {
                        replaceActorsForAssignable(input: {
                          assignableId: $assignableId,
                          actorIds: $actorIds
                        }) {
                          __typename
                        }
                      }
                    `;

                const result = await github.graphql(mutation, {
                  assignableId: pullRequest.id,
                  actorIds,
                  ...(customAgent ? { customAgent, customInstructions, baseRef } : {}),
                  headers: {
                    "GraphQL-Features": "issues_copilot_assignment_api_support",
                  },
                });

                if (!result?.replaceActorsForAssignable?.__typename) {
                  fail(`GitHub did not confirm the tasks agent assignment update for PR #${pullNumber}.`);
                }
              };

              if (copilotAlreadyAssigned) {
                core.info(`Copilot is already assigned to PR #${pullNumber}; forcing a fresh reassignment for the tasks wrapper.`);
                await replaceActors({
                  actorIds: (await getCurrentAssigneeIds()).filter(id => id !== agent.id),
                });
                await waitForCopilotUnassignment({ timeoutMs: 30000 });
              }

              // Work around the upstream gh aw PR-target assignment bug by performing the PR reassignment directly.
              // We also force a fresh reassignment when Copilot is already present and forward the exact startup
              // comment body through customInstructions so the new session starts with explicit tasks context.
              const actorIds = [agent.id, ...(await getCurrentAssigneeIds()).filter(id => id !== agent.id)];
              await replaceActors({
                actorIds,
                customAgent: "agentic-flow-tasks",
                customInstructions,
                baseRef: baseRefName,
              });

              await waitForCopilotAssignment({ timeoutMs: 30000 });
              await sleep(5000);

              const triggerComment = await github.rest.issues.createComment({
                owner,
                repo,
                issue_number: pullNumberInt,
                body: startupCommentBody,
              });

              if (!triggerComment?.data?.id) {
                fail(`GitHub did not confirm the tasks trigger comment on PR #${pullNumber}.`);
              }

              core.info(`Posted tasks trigger comment ${triggerComment.data.id} on PR #${pullNumber}.`);
              core.info(`Assigned agentic-flow-tasks to PR #${pullNumber}.`);

concurrency:
  group: tasks-pr-${{ github.event.issue.number }}
  cancel-in-progress: false

env:
  COPILOT_MODEL: claude-sonnet-4-6

mcp-servers:
  github:
    type: http
    url: https://api.githubcopilot.com/mcp/
    headers:
      Authorization: "Bearer ${{ github.token }}"
---

You are the tasks agent for the agentic-flow pipeline. You have been triggered by `/approve-plan` on PR #${{ github.event.issue.number }}. Follow these instructions exactly.

## Phase Guard

Run all six guards in order. Post the rejection comment and exit immediately on the first failure.

### 1. PR Context Guard

Call `get_pull_request(${{ github.event.issue.number }})`.

If the call fails (the number is not a PR), post:
```markdown
## ❌ Wrong Location

`/approve-plan` must be posted as a comment on the spec PR, not on a Feature Issue.

Find your open spec PR and post `/approve-plan` there.
```
Exit immediately.

### 2. PR Open Guard

If the PR `state` is not `open`, post:
```markdown
## ❌ PR is Closed

This spec PR is closed or merged. No action taken.
```
Exit immediately.

### 3. Context Handoff Guard

Find the most recent PR comment containing `<!-- agentic-flow-context` that is authored by the GitHub Copilot coding agent. Treat `copilot`, `copilot[bot]`, `copilot-swe-agent`, and `copilot-swe-agent[bot]` as trusted logins. Ignore context blocks posted by any other author.

Extract:
- `Feature issue: #N`
- `Spec directory: specs/{NNN}-{name}`

If no such comment exists, or either field is missing, post:
```markdown
## ❌ Context Not Found

The tasks phase could not locate a trusted `agentic-flow-context` block on this PR.

Wait for the latest wrapper summary comment to appear. If the required trusted summary comment is missing, re-run `/refine-spec` on this PR while the spec phase is still open, or use `/start-spec` on the feature issue if this PR was created outside agentic-flow. Then try `/approve-plan` again.
```
Exit immediately.

### 4. `plan.md` Existence Guard

Call `get_file_contents("{spec_dir}/plan.md", head.ref)`.

If the file does not exist (404), post:
```markdown
## ❌ Plan Not Found

`plan.md` is not present on this PR's head branch. Use `/approve-spec` to generate the plan first.
```
Exit immediately.

### 5. `tasks.md` Idempotency Guard

Check `{spec_dir}/tasks.md` on `head.ref`.

If `tasks.md` already exists, post:
```markdown
## ℹ️ Tasks Already Generated

`tasks.md` already exists on this branch. Review `tasks.md` and merge the PR when satisfied.
```
Exit.

### 6. `[NEEDS CLARIFICATION]` Scan

Read `{spec_dir}/plan.md` content. Scan for any `[NEEDS CLARIFICATION:` substrings.

If any are found, post:
```markdown
## ❌ Unresolved Clarification Markers

The following `[NEEDS CLARIFICATION:]` markers were found in `plan.md` and must be resolved before the tasks phase can proceed:

{list each marker with surrounding context}

Please resolve these markers in this PR, commit the changes, and then re-issue `/approve-plan`.
```
Exit immediately.

## Step 1 — Invoke agentic-flow-tasks

The spec PR is `#${{ github.event.issue.number }}` — this is the PR on which `/approve-plan` was received. Use its number directly.

Find the most recent PR comment containing `<!-- agentic-flow-context` that is authored by the GitHub Copilot coding agent. Treat `copilot`, `copilot[bot]`, `copilot-swe-agent`, and `copilot-swe-agent[bot]` as trusted logins, ignore context blocks from any other author, and extract the exact `Feature issue` and `Spec directory` values from the trusted comment. Use those exact values here.

1. Call the `assign_tasks_agent_workaround` safe-output with:
   - `pull_number`: the numeric triggering spec PR number from the GitHub context (digits only, for example `25`)
   - `feature_issue_number`: the numeric feature issue number extracted from the latest context block (digits only, for example `10`)
   - `spec_directory`: the exact spec directory extracted from the latest context block (for example `specs/001-tic-tac-toe`)

   The assignment workaround will build the exact startup comment body itself, including a direct natural-language `@copilot` request and the hidden `agentic-flow-context` block, then post that generated comment after assigning the custom agent.

   Note: the current built-in `assign_to_agent` PR path is internally inconsistent: the tool schema accepts `pull_number`, but the explicit PR target resolver later expects `pull_request_number`, which causes the built-in assignment step to fail.
   Also note: on existing PRs, reassignment alone did not reliably start work in testing, so this workflow posts the `@copilot` trigger comment after assigning the custom agent.

**Do NOT post any other comment.** The 👁️ reaction from the slash command is sufficient. Only post on error (see Error Handling below).

## Error Handling

If any step fails unexpectedly, post:
```markdown
## ❌ Tasks Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-issue `/approve-plan` on this spec PR to retry tasks generation.

_Automated recovery comment — agentic-flow_
```
Ensure the workflow exits with a clear error state.
