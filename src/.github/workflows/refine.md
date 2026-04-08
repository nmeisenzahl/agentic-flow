---
name: Refine Spec Agent (agentic-flow)
on:
  slash_command: refine-spec

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  add-comment: null
  jobs:
    assign-refine-agent-workaround:
      description: Assign the triggering spec PR to the agentic-flow-spec wrapper in refine mode and post the generated startup comment.
      output: Refine spec agent assignment requested.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        contents: read
        pull-requests: write
      inputs:
        pull_number:
          description: String form of the spec PR number that received /refine-spec. Must match the triggering PR.
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
        - name: Assign agentic-flow-spec wrapper in refine mode
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
                core.info("Staged mode enabled; skipping refine agent assignment workaround.");
                return;
              }

              if (!process.env.GH_AW_AGENT_TOKEN) {
                fail("GH_AW_AGENT_TOKEN secret is not configured. The refine assignment workaround requires a PAT for Copilot agent assignment.");
              }

              const outputPath = process.env.GH_AW_AGENT_OUTPUT;
              if (!outputPath || !fs.existsSync(outputPath)) {
                fail("GH_AW_AGENT_OUTPUT is not available for the refine assignment workaround.");
              }

              let parsed;
              try {
                parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
              } catch (error) {
                fail(`Failed to parse GH_AW_AGENT_OUTPUT for the refine assignment workaround: ${error instanceof Error ? error.message : String(error)}.`);
              }

              const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
              const items = parsedItems.filter(item => item.type === "assign_refine_agent_workaround");

              if (items.length === 0) {
                core.info("No assign_refine_agent_workaround requests found.");
                return;
              }

              if (items.length > 1) {
                fail(`Expected exactly one assign_refine_agent_workaround request, found ${items.length}.`);
              }

              const pullNumber = String(items[0].pull_number ?? "").trim();
              if (!/^[1-9]\d*$/.test(pullNumber)) {
                fail(`Invalid pull_number for refine agent assignment: ${JSON.stringify(items[0].pull_number)}.`);
              }

              const expectedPullNumber = String(context.issue.number ?? "").trim();
              if (!expectedPullNumber) {
                fail("The triggering PR number is not available in github.context.issue.number.");
              }
              if (pullNumber !== expectedPullNumber) {
                fail(`assign_refine_agent_workaround must target the triggering PR #${expectedPullNumber}, received #${pullNumber}.`);
              }

              const featureIssueNumber = String(items[0].feature_issue_number ?? "").trim();
              if (!/^[1-9]\d*$/.test(featureIssueNumber)) {
                fail(`Invalid feature_issue_number for refine agent assignment: ${JSON.stringify(items[0].feature_issue_number)}.`);
              }

              const specDirectory = String(items[0].spec_directory ?? "").trim();
              if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) {
                fail(`Invalid spec_directory for refine agent assignment: ${JSON.stringify(items[0].spec_directory)}.`);
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

                fail(`Copilot did not appear as an assignee on PR #${pullNumber} after the refine assignment update.`);
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

                fail(`Copilot remained assigned to PR #${pullNumber} after the refine reassignment reset step.`);
              };

              const startupCommentBody = [
                `@copilot please use the already-assigned \`agentic-flow-spec\` custom agent to refine \`${specDirectory}/spec.md\` for this pull request using the latest PR feedback, commit the updated spec to \`${headRefName}\`, and post a concise summary here.`,
                "",
                "<!-- agentic-flow-context",
                "Phase: spec",
                "Run mode: refine",
                `Feature issue: #${featureIssueNumber}`,
                `Spec directory: ${specDirectory}`,
                `Primary artefact: ${specDirectory}/spec.md`,
                "Speckit phase agent: .github/agents/speckit.specify.agent.md",
                "Clarify agent: .github/agents/speckit.clarify.agent.md",
                "Analyze agent: .github/agents/speckit.analyze.agent.md",
                "Constitution: .specify/memory/constitution.md",
                "-->",
                "## Refine Spec Agent — Startup Instructions",
                "",
                "You are the refine-spec agent in the agentic-flow pipeline.",
                "",
                `**Your task**: Regenerate \`${specDirectory}/spec.md\` in place for this existing spec pull request.`,
                "",
                "| Field | Value |",
                "| --- | --- |",
                `| Feature Issue | #${featureIssueNumber} |`,
                `| Spec PR | #${pullNumber} |`,
                `| Spec directory | \`${specDirectory}\` |`,
                `| Primary artefact | \`${specDirectory}/spec.md\` |`,
                `| Feature branch | \`${headRefName}\` |`,
                "",
                "### Instructions",
                `1. Read \`${specDirectory}/spec.md\`, the current PR description, and the latest unresolved PR comments and reviews in full.`,
                `2. Use the speckit.specify, speckit.clarify, and speckit.analyze agents (or equivalent templates) to refine \`${specDirectory}/spec.md\` and any required spec-stage supporting artefacts in place.`,
                `3. Keep all work on the existing branch \`${headRefName}\`. Do not create a new branch or PR.`,
                `4. Commit and push the updated spec-stage artefacts to \`${headRefName}\`.`,
                `5. Post a concise summary comment on PR #${pullNumber} with the refinement highlights and gate results.`,
                "",
                "**For the human reviewer**: after reviewing the refined spec, use `/approve-spec` to start planning or `/refine-spec` for another spec iteration. Do not execute those commands yourself.",
                "",
                `Triggered by \`/refine-spec\` on PR #${pullNumber} — agentic-flow`,
              ].join("\n");

              core.info(`Generated refine startup comment body for PR #${pullNumber}.`);

              const customInstructions = [
                "You are starting the agentic-flow refine phase for the current pull request.",
                "Use the exact startup comment body below as the authoritative phase context for this assignment.",
                "The expected phase for this assignment is `spec` with run mode `refine`.",
                "This startup context was generated by the refine assignment workflow for the current run.",
                "",
                "Use this exact startup comment:",
                startupCommentBody,
                "",
                "Regenerate only the spec-stage artefacts for the current PR branch.",
              ].join("\n");

              if (customInstructions.length > 8000) {
                fail(`Refine startup instructions are too large (${customInstructions.length} characters).`);
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
                  fail(`GitHub did not confirm the refine agent assignment update for PR #${pullNumber}.`);
                }
              };

              if (copilotAlreadyAssigned) {
                core.info(`Copilot is already assigned to PR #${pullNumber}; forcing a fresh reassignment for the refine wrapper.`);
                await replaceActors({
                  actorIds: (await getCurrentAssigneeIds()).filter(id => id !== agent.id),
                });
                await waitForCopilotUnassignment({ timeoutMs: 30000 });
              }

              // Work around the upstream gh aw PR-target assignment bug by performing the PR reassignment directly.
              // We also force a fresh reassignment when Copilot is already present and forward the exact startup
              // comment body through customInstructions so the new session starts with explicit refine context.
              const actorIds = [agent.id, ...(await getCurrentAssigneeIds()).filter(id => id !== agent.id)];
              await replaceActors({
                actorIds,
                customAgent: "agentic-flow-spec",
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
                fail(`GitHub did not confirm the refine trigger comment on PR #${pullNumber}.`);
              }

              core.info(`Posted refine trigger comment ${triggerComment.data.id} on PR #${pullNumber}.`);
              core.info(`Assigned agentic-flow-spec to PR #${pullNumber}.`);

concurrency:
  group: refine-pr-${{ github.event.issue.number }}
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

# Refine Spec Agent

You are the refine-spec agent for the agentic-flow pipeline. You have been triggered by `/refine-spec` on PR #${{ github.event.issue.number }}. Follow these instructions exactly.

## Phase Guard

Run all five guards in order. Post the rejection comment and exit immediately on the first failure.

### 1. PR Context Guard

Call `get_pull_request(${{ github.event.issue.number }})`.

If the call fails (the number is not a PR), post:
```markdown
## ❌ Wrong Location

`/refine-spec` must be posted as a comment on the spec PR, not on a Feature Issue.

Find your open spec PR and post `/refine-spec` there.
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

The refine phase could not locate a trusted `agentic-flow-context` block on this PR.

Wait for the latest spec wrapper summary comment to appear, or re-run `/start-spec` if this PR was created outside agentic-flow.
```
Exit immediately.

### 4. `spec.md` Existence Guard

Call `get_file_contents("{spec_dir}/spec.md", head.ref)`.

If the file does not exist (404), post:
```markdown
## ❌ Spec Not Found

`spec.md` is not present on this PR's head branch. The spec phase has not completed.
```
Exit immediately.

### 5. Backward Command Guard

Check `{spec_dir}/plan.md` on `head.ref`. If the file **exists**, post:
```markdown
## ❌ Too Late for Refinement

`/refine-spec` can only be used while the spec is still open (before `/approve-spec` is run).

`plan.md` already exists on this branch, meaning the plan phase has already started.

Use `/approve-plan` if the plan is ready, or open a new spec PR if you need to iterate further.
```
Exit immediately.

## Step 1 — Invoke agentic-flow-spec

The spec PR is `#${{ github.event.issue.number }}` — this is the PR on which `/refine-spec` was received. Use its number directly.

Find the most recent PR comment containing `<!-- agentic-flow-context` that is authored by the GitHub Copilot coding agent. Treat `copilot`, `copilot[bot]`, `copilot-swe-agent`, and `copilot-swe-agent[bot]` as trusted logins, ignore context blocks from any other author, and extract the exact `Feature issue` and `Spec directory` values from the trusted comment. Use those exact values here.

1. Call the `assign_refine_agent_workaround` safe-output with:
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
## ❌ Refine Spec Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-issue `/refine-spec` on this spec PR to retry spec refinement.

_Automated recovery comment — agentic-flow_
```
Ensure the workflow exits with a clear error state.
