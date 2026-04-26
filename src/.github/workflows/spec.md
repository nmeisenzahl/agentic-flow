---
name: Spec Agent (agentic-flow)
on:
  slash_command: start-spec

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  report-failure-as-issue: false
  create-issue: null
  add-comment: null
  add-labels:
    target: "*"
    allowed: [spec-in-progress]
  jobs:
    assign-spec-agent-workaround:
      description: Create the spec branch and draft PR, then assign agentic-flow-spec with a PR-scoped token and post the startup comment.
      output: Spec agent assignment requested.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        contents: write
        pull-requests: write
        issues: write
      inputs:
        feature_issue_number:
          description: Numeric feature issue number (e.g. 28). Must match the triggering Feature Issue.
          required: true
          type: string
      steps:
        - name: Create branch, draft PR, and assign agentic-flow-spec
          uses: actions/github-script@v8
          env:
            GH_AW_AGENT_TOKEN: ${{ secrets.GH_AW_AGENT_TOKEN }}
          with:
            github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
            script: |
              const fs = require("fs");
              const fail = msg => { throw new Error(msg); };

              if (!process.env.GH_AW_AGENT_TOKEN) {
                fail("GH_AW_AGENT_TOKEN secret is not configured. The spec assignment workaround requires a PAT.");
              }

              const outputPath = process.env.GH_AW_AGENT_OUTPUT;
              if (!outputPath || !fs.existsSync(outputPath)) {
                fail("GH_AW_AGENT_OUTPUT is not available for the spec assignment workaround.");
              }

              let parsed;
              try {
                parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
              } catch (e) {
                fail(`Failed to parse GH_AW_AGENT_OUTPUT: ${e instanceof Error ? e.message : String(e)}.`);
              }

              const items = (Array.isArray(parsed.items) ? parsed.items : [])
                .filter(item => item.type === "assign_spec_agent_workaround");

              if (items.length === 0) {
                core.info("No assign_spec_agent_workaround requests found.");
                return;
              }
              if (items.length > 1) {
                fail(`Expected exactly one assign_spec_agent_workaround request, found ${items.length}.`);
              }

              const itemFeatureNumber = String(items[0].feature_issue_number ?? "").trim();
              if (!/^[1-9]\d*$/.test(itemFeatureNumber)) {
                fail(`Invalid feature_issue_number in assign_spec_agent_workaround item: ${JSON.stringify(itemFeatureNumber)}.`);
              }

              const owner = context.repo.owner;
              const repo = context.repo.repo;
              const featureIssueNumber = Number(itemFeatureNumber);

              if (featureIssueNumber !== context.issue.number) {
                fail(`assign_spec_agent_workaround feature_issue_number (${featureIssueNumber}) does not match triggering issue (${context.issue.number}).`);
              }

              // Fetch feature issue for title and default branch/Copilot actor
              const featureIssue = await github.rest.issues.get({ owner, repo, issue_number: featureIssueNumber });
              const featureIssueTitle = featureIssue.data.title;

              const repoData = await github.graphql(`
                query($owner: String!, $repo: String!) {
                  repository(owner: $owner, name: $repo) {
                    suggestedActors(first: 100, capabilities: CAN_BE_ASSIGNED) {
                      nodes {
                        ... on Bot { __typename id login }
                        ... on User { __typename id login }
                      }
                    }
                    defaultBranchRef { name target { oid } }
                  }
                }
              `, { owner, repo });

              const isCopilotLogin = l => typeof l === "string" && /^(copilot|copilot-swe-agent)(\[bot\])?$/i.test(l.trim());
              const copilotActor = (repoData.repository?.suggestedActors?.nodes || []).find(n => isCopilotLogin(n?.login));
              if (!copilotActor?.id) fail("Copilot coding agent is not available as an assignee for this repository.");

              const defaultBranchSha = repoData.repository?.defaultBranchRef?.target?.oid;
              const defaultBranchName = repoData.repository?.defaultBranchRef?.name;
              if (!defaultBranchSha || !defaultBranchName) fail("Could not determine default branch.");

              // Derive branch name from feature issue number and title
              const kebabTitle = featureIssueTitle
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .substring(0, 50);
              const branchName = `copilot/spec-${featureIssueNumber}-${kebabTitle}`;

              // Find sub-issue created by create_issue safe-output
              const subIssueTitle = `Spec/Plan/Tasks: ${featureIssueTitle}`;
              const issuesResp = await github.rest.issues.listForRepo({
                owner, repo, labels: "spec-in-progress", state: "open", per_page: 100
              });
              const subIssue = issuesResp.data.find(i => i.title === subIssueTitle && !i.pull_request);
              if (!subIssue) fail(`Could not find spec tracking sub-issue titled "${subIssueTitle}".`);
              const subIssueNumber = subIssue.number;

              // Create branch with an initial empty commit (idempotent).
              // GitHub rejects PR creation when head has no commits ahead of base,
              // so we must push at least one commit before opening the PR.
              let branchHeadSha = defaultBranchSha;
              try {
                await github.rest.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: defaultBranchSha });
                core.info(`Created branch ${branchName}.`);
                // Push an empty commit so GitHub allows PR creation.
                const baseCommit = await github.rest.git.getCommit({ owner, repo, commit_sha: defaultBranchSha });
                const emptyCommit = await github.rest.git.createCommit({
                  owner, repo,
                  message: "chore: initialize spec branch",
                  tree: baseCommit.data.tree.sha,
                  parents: [defaultBranchSha],
                });
                await github.rest.git.updateRef({ owner, repo, ref: `heads/${branchName}`, sha: emptyCommit.data.sha });
                branchHeadSha = emptyCommit.data.sha;
                core.info(`Pushed initial commit ${emptyCommit.data.sha} to ${branchName}.`);
              } catch (e) {
                if (e.status === 422) {
                  core.info(`Branch ${branchName} already exists; continuing.`);
                } else { throw e; }
              }

              // Create draft PR (idempotent)
              let prNumber, headRefName, prId;
              try {
                const pr = await github.rest.pulls.create({
                  owner, repo,
                  title: subIssueTitle,
                  body: `Closes #${subIssueNumber}`,
                  head: branchName, base: defaultBranchName, draft: true,
                });
                prNumber = pr.data.number;
                headRefName = pr.data.head.ref;
                core.info(`Created draft PR #${prNumber}.`);
              } catch (e) {
                if (e.status === 422) {
                  const existing = await github.rest.pulls.list({ owner, repo, head: `${owner}:${branchName}`, state: "open" });
                  if (existing.data.length > 0) {
                    prNumber = existing.data[0].number;
                    headRefName = existing.data[0].head.ref;
                    core.info(`Draft PR for branch ${branchName} already exists as #${prNumber}; continuing.`);
                  } else { throw e; }
                } else { throw e; }
              }

              // Get PR node ID
              const prData = await github.graphql(`
                query($owner: String!, $repo: String!, $prNumber: Int!) {
                  repository(owner: $owner, name: $repo) {
                    pullRequest(number: $prNumber) { id }
                  }
                }
              `, { owner, repo, prNumber });
              prId = prData.repository?.pullRequest?.id;
              if (!prId) fail(`Could not get PR node ID for #${prNumber}.`);

              // Build startup comment
              const contextBlock = [
                "<!-- agentic-flow-context",
                "Phase: spec",
                "Run mode: start",
                `Feature issue: #${featureIssueNumber}`,
                "Speckit phase agent: .github/agents/speckit.specify.agent.md",
                "Clarify agent: .github/agents/speckit.clarify.agent.md",
                "Analyze agent: .github/agents/speckit.analyze.agent.md",
                "Constitution: .specify/memory/constitution.md",
                "-->",
              ].join("\n");

              const instructions = [
                `1. Read Feature Issue #${featureIssueNumber} in full.`,
                "2. Use the speckit.specify, speckit.clarify, and speckit.analyze agents (or equivalent templates) to generate the spec-stage artefacts.",
                `3. Commit and push the spec-stage artefacts to the PR branch \`${headRefName}\`.`,
                `4. Post a summary comment on PR #${prNumber} using the **PR Summary Format** from your \`agentic-flow-spec\` agent instructions. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block exactly as specified — this is machine-critical for the next pipeline phase.`,
              ].join("\n");

              const startupCommentBody = [
                `@copilot please use the already-assigned \`agentic-flow-spec\` custom agent to generate the spec for Feature Issue #${featureIssueNumber} on this pull request, commit the result to \`${headRefName}\`, and post your completion summary using the **PR Summary Format** from your agent instructions (the comment MUST include the \`<!-- agentic-flow-context ... -->\` block).`,
                "",
                contextBlock,
                "## Spec Agent — Startup Instructions",
                "",
                "You are the spec agent in the agentic-flow pipeline.",
                "",
                `**Your task**: Generate the spec artefacts for Feature Issue #${featureIssueNumber}.`,
                "",
                "| Field | Value |",
                "| --- | --- |",
                `| Feature Issue | #${featureIssueNumber} |`,
                `| Spec PR | #${prNumber} |`,
                `| Feature branch | \`${headRefName}\` |`,
                "",
                "### Instructions",
                instructions,
                "",
                `> [!IMPORTANT]`,
                `> **👉 Next step for the human reviewer:** Once you have reviewed the spec, post **\`/approve-spec\`** as a comment on this PR to proceed to plan generation. Do not execute that command yourself.`,
                "",
                `Triggered by \`/start-spec\` on Issue #${featureIssueNumber} — agentic-flow`,
              ].join("\n");

              const customInstructions = [
                "You are starting the agentic-flow spec phase for the current pull request.",
                "Use the exact startup comment body below as the authoritative phase context for this assignment.",
                "The expected phase for this assignment is `spec` with run mode `start`.",
                "This startup context was generated by the spec assignment workflow for the current run.",
                "",
                "Use this exact startup comment:",
                startupCommentBody,
                "",
                "Generate only the spec-stage artefacts for the current PR branch.",
              ].join("\n");

              if (customInstructions.length > 8000) {
                fail(`Spec startup instructions are too large (${customInstructions.length} characters).`);
              }

              // Assign Copilot to the PR via replaceActorsForAssignable
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              const isCopilotAssigned = async () => {
                const pr = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
                return (pr.data.assignees || []).some(a => isCopilotLogin(a.login));
              };

              if (await isCopilotAssigned()) {
                core.info(`Copilot already assigned to PR #${prNumber}; forcing reassignment.`);
                await github.graphql(`
                  mutation($id: ID!, $actors: [ID!]!) {
                    replaceActorsForAssignable(input: { assignableId: $id, actorIds: $actors }) { __typename }
                  }
                `, { id: prId, actors: [], headers: { "GraphQL-Features": "issues_copilot_assignment_api_support" } });
                const deadline2 = Date.now() + 30000;
                while (Date.now() < deadline2) {
                  if (!(await isCopilotAssigned())) break;
                  await sleep(2000);
                }
              }

              const result = await github.graphql(`
                mutation($id: ID!, $actors: [ID!]!, $agent: String!, $instructions: String!, $base: String!) {
                  replaceActorsForAssignable(input: {
                    assignableId: $id, actorIds: $actors,
                    agentAssignment: { customAgent: $agent, customInstructions: $instructions, baseRef: $base }
                  }) { __typename }
                }
              `, {
                id: prId,
                actors: [copilotActor.id],
                agent: "agentic-flow-spec",
                instructions: customInstructions,
                base: defaultBranchName,
                headers: { "GraphQL-Features": "issues_copilot_assignment_api_support" },
              });

              if (!result?.replaceActorsForAssignable?.__typename) {
                fail(`GitHub did not confirm the spec agent assignment for PR #${prNumber}.`);
              }

              const deadline = Date.now() + 30000;
              while (Date.now() < deadline) {
                if (await isCopilotAssigned()) break;
                await sleep(2000);
              }
              await sleep(5000);

              const triggerComment = await github.rest.issues.createComment({
                owner, repo, issue_number: prNumber, body: startupCommentBody,
              });
              if (!triggerComment?.data?.id) fail(`GitHub did not confirm the spec trigger comment on PR #${prNumber}.`);

              core.info(`Posted spec trigger comment ${triggerComment.data.id} on PR #${prNumber}.`);
              core.info(`Assigned agentic-flow-spec to PR #${prNumber}.`);

concurrency:
  group: spec-issue-${{ github.event.issue.number }}
  cancel-in-progress: false

network:
  allowed:
    - defaults

env:
  COPILOT_MODEL: claude-sonnet-4-6

mcp-servers:
  github:
    type: http
    url: https://api.githubcopilot.com/mcp/
    headers:
      Authorization: "Bearer ${{ github.token }}"
---

# Spec Agent

You are the spec agent for the agentic-flow pipeline. You have been triggered by `/start-spec` on issue #${{ github.event.issue.number }}. Follow these instructions exactly.

## Phase Guard

### `[NEEDS CLARIFICATION]` Scan

Before proceeding, scan any incoming artefact for `[NEEDS CLARIFICATION:` substrings. If found:
1. Post a rejection comment identifying each unresolved marker.
2. Exit immediately — do NOT proceed with the phase.

### Phase Label Guard

Verify the Feature Issue has the `research-complete` label AND does NOT have the `needs-refinement` label. If the label check fails, post an explanatory rejection comment and exit.

### Backward Command Guard

If `plan.md` already exists on the spec branch, the pipeline is past this phase. Post a rejection comment explaining this and exit.

## Step 1 — Pre-condition: needs-refinement Check

Check if issue #${{ github.event.issue.number }} has the `needs-refinement` label.

**If YES**: Post a comment on the issue:
```
@{issue.user.login} This issue has been flagged as needing more detail before a spec can be started.

Please update the issue description with the missing information so that triage can reclassify it. Once the issue no longer has the `needs-refinement` label, you can re-issue `/start-spec`.

To re-triage after updating: post `/retry-triage` as a comment.
```
**Exit immediately** — do not continue.

## Step 2 — Pre-condition: research-complete Check

Check if issue #${{ github.event.issue.number }} has the `research-complete` label.

**If NOT present**: Post a comment:
```
Research has not completed for this issue yet. The `/start-spec` command can only be used after research findings appear in the issue description.

Research starts automatically when the `needs-spec` label is applied. If research is stuck, check the Actions tab for `research.lock.yml` run status, or manually dispatch the research workflow.
```
**Exit immediately** — do not continue.

## Step 3 — Idempotency Check

Search for an open tracking sub-issue titled `Spec/Plan/Tasks: {issue title}` and any open PR on a branch named `copilot/spec-${{ github.event.issue.number }}-*`.

- **If an open PR already exists**: Post a comment linking to that PR:
  ```
  A spec PR already exists for this issue: #{PR_NUMBER}

  Review the existing spec PR and post `/approve-spec` there when ready to proceed to the plan phase.
  ```
  Exit immediately.

- **If an open tracking sub-issue exists but no PR is visible yet**: Post:
  ```
  A spec tracking issue already exists for this feature: #{ISSUE_NUMBER}

  The spec assignment workflow is creating the draft PR. Wait a moment, then check for a new PR on this issue.
  ```
  Exit immediately.

## Step 4 — Create Spec Sub-issue and Trigger agentic-flow-spec

The spec PR is produced by the `agentic-flow-spec` wrapper on top of the speckit spec agents. Your job is to create a tracking sub-issue, apply the label, then emit the assignment workaround item. The assignment workflow will create the branch, open a draft PR, and assign the `agentic-flow-spec` agent directly to that PR.

1. Call the `create_issue` safe-output to create the spec tracking sub-issue:
   - Title: `Spec/Plan/Tasks: ${{ github.event.issue.title }}`
   - Body: `Spec tracking issue for Feature #${{ github.event.issue.number }}.`
   - Labels: `spec-in-progress`

   The sub-issue will be automatically linked as a child of issue #${{ github.event.issue.number }}. Do NOT call `link_sub_issue` separately.

2. Apply `spec-in-progress` label to issue #${{ github.event.issue.number }} using the `add_labels` safe-output.

3. Call the `assign_spec_agent_workaround` safe-output with:
   - `feature_issue_number`: `${{ github.event.issue.number }}` (digits only)

   The assignment workflow will create the branch and draft PR, build the startup comment with the `<!-- agentic-flow-context -->` block, assign `agentic-flow-spec` directly to the PR, and post the startup comment.

**Do NOT post any comment on the issue.** The 👁️ reaction from the slash command is sufficient. Only post a comment on error (see Error Handling below).

## Issue Body — Preservation Rule

The Feature Issue body is a structured history maintained by the pipeline. **Do NOT rewrite or replace it.** Only post comments using `create_issue_comment`. If you or the assigned wrapper agent needs to append a section to the issue body, insert it immediately BEFORE the `<!-- original-body -->` marker and never remove that marker or the `<details>` block beneath it.

## Error Handling

If any step fails unexpectedly, use `create_issue_comment` to post the following comment on Feature Issue `#${{ github.event.issue.number }}`:
```markdown
## ❌ Spec Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-issue `/start-spec` on this issue. The idempotency check will link to the existing PR if it was already created.

_Automated recovery comment — agentic-flow_
```

Ensure the workflow exits with a clear error state.
