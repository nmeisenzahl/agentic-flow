---
name: Create Task Issues (agentic-flow)
on:
  workflow_dispatch:
    inputs:
      feature_issue_number:
        description: Feature issue number (digits only, e.g. 12)
        required: true
        type: string
      spec_directory:
        description: Spec directory (e.g. specs/001-feature-name)
        required: true
        type: string
      pr_number:
        description: Merged spec PR number (for reference only)
        required: true
        type: string

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  report-failure-as-issue: false
  add-comment: null
  jobs:
    create-task-issues:
      description: Creates task sub-issues from the task list parsed by the agent and links them to the Feature Issue.
      output: Task issue creation completed.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        issues: write
        contents: read
      inputs:
        tasks_json:
          description: JSON array of task objects parsed from tasks.md by the agent. Each object has title (string) and description (string).
          required: true
          type: string
        feature_issue_number:
          description: Feature Issue number to link task issues to as sub-issues.
          required: true
          type: string
        spec_directory:
          description: Spec directory where tasks.md lives.
          required: true
          type: string
        pr_number:
          description: Merged spec PR number (for reference in summary comment).
          required: true
          type: string
        skipped_count:
          description: Number of tasks skipped because a matching sub-issue already exists.
          required: false
          type: string
      steps:
        - name: Create task issues and link sub-issues
          uses: actions/github-script@v8
          env:
            TASKS_JSON: ${{ inputs.tasks_json }}
            FEATURE_ISSUE_NUMBER: ${{ inputs.feature_issue_number }}
            SPEC_DIRECTORY: ${{ inputs.spec_directory }}
            PR_NUMBER: ${{ inputs.pr_number }}
            SKIPPED_COUNT: ${{ inputs.skipped_count }}
          with:
            github-token: ${{ github.token }}
            script: |
              const fail = message => { throw new Error(message); };

              // ${{ inputs.* }} resolves to workflow_dispatch inputs in this context.
              // tasks_json and skipped_count are not dispatch inputs, so they must be
              // read from the agent output artifact that the framework downloads to
              // GH_AW_AGENT_OUTPUT before our step runs.
              let agentItem = {};
              const agentOutputPath = process.env.GH_AW_AGENT_OUTPUT;
              if (agentOutputPath) {
                try {
                  const fs = require("fs");
                  const agentOutput = JSON.parse(fs.readFileSync(agentOutputPath, "utf8"));
                  agentItem = (agentOutput.items || []).find(i => i.type === "create_task_issues") || {};
                } catch (e) {
                  core.warning(`Could not read agent output at ${agentOutputPath}: ${e.message}`);
                }
              }

              const featureIssueNumber = parseInt(process.env.FEATURE_ISSUE_NUMBER, 10);
              if (!Number.isFinite(featureIssueNumber) || featureIssueNumber < 1) {
                fail(`Invalid feature_issue_number: ${JSON.stringify(process.env.FEATURE_ISSUE_NUMBER)}`);
              }

              const specDirectory = String(process.env.SPEC_DIRECTORY ?? "").trim();
              if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) {
                fail(`Invalid spec_directory: ${JSON.stringify(specDirectory)}`);
              }

              const prNumber = String(process.env.PR_NUMBER ?? "").trim();
              const rawSkipped = (process.env.SKIPPED_COUNT ?? "").trim() || (agentItem.skipped_count ?? "0");
              const skippedCount = parseInt(rawSkipped, 10) || 0;
              const owner = context.repo.owner;
              const repo = context.repo.repo;

              const rawTasksJson = (process.env.TASKS_JSON ?? "").trim() || (agentItem.tasks_json ?? "");
              let tasks;
              try {
                tasks = rawTasksJson ? JSON.parse(rawTasksJson) : [];
              } catch (e) {
                fail(`Failed to parse tasks_json: ${e.message}`);
              }

              if (!Array.isArray(tasks) || tasks.length === 0) {
                await github.rest.issues.createComment({
                  owner, repo,
                  issue_number: featureIssueNumber,
                  body: `## ⚠️ Post-Merge Warning\n\nNo tasks were found in \`${specDirectory}/tasks.md\`. No task sub-issues were created.\n\n_Post-merge automation — agentic-flow_`
                });
                core.warning("tasks_json is empty — skipping issue creation");
                return;
              }

              const sleep = ms => new Promise(r => setTimeout(r, ms));
              const created = [];
              const failures = [];

              for (const task of tasks) {
                if (!task.title || typeof task.title !== "string") {
                  core.warning(`Skipping task with missing or invalid title: ${JSON.stringify(task)}`);
                  continue;
                }

                const body = [
                  task.description || "",
                  "",
                  "---",
                  `**Spec artefacts**: \`${specDirectory}/tasks.md\``,
                  `**Feature Issue**: #${featureIssueNumber}`,
                  task.id ? `**Task ID**: ${task.id}` : "",
                ].filter(line => line !== undefined).join("\n").trim();

                const issue = await github.rest.issues.create({
                  owner, repo,
                  title: task.title.trim(),
                  body,
                  labels: ["agentic-flow-task"],
                });

                created.push({ number: issue.data.number, title: task.title.trim(), id: issue.data.id });

                try {
                  await github.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
                    owner, repo,
                    issue_number: featureIssueNumber,
                    sub_issue_id: issue.data.id,
                  });
                } catch (e) {
                  core.warning(`Sub-issue link failed for #${issue.data.number}: ${e.message}`);
                  failures.push(`#${issue.data.number}: ${e.message}`);
                }

                await sleep(tasks.length > 20 ? 1000 : 500);
              }

              const issueList = created.map(i => `- #${i.number}: ${i.title}`).join("\n");
              const failureNote = failures.length > 0
                ? `\n\n⚠️ **Sub-issue link failures** (${failures.length}):\n${failures.map(f => `- ${f}`).join("\n")}`
                : "";

              await github.rest.issues.createComment({
                owner, repo,
                issue_number: featureIssueNumber,
                body: [
                  "## ✅ Task Sub-Issues Created",
                  "",
                  `**Spec PR**: #${prNumber}`,
                  `**Spec directory**: \`${specDirectory}\``,
                  `**Tasks processed**: ${tasks.length + skippedCount}`,
                  `**New task issues created**: ${created.length}`,
                  `**Already existed (skipped)**: ${skippedCount}`,
                  "",
                  issueList,
                  failureNote,
                  "",
                  "_Post-merge automation — agentic-flow_",
                ].join("\n").trim(),
              });

concurrency:
  group: post-merge-${{ github.event.inputs.pr_number }}
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

You are the post-merge agent for the agentic-flow pipeline. You have been dispatched after merging spec PR `#${{ github.event.inputs.pr_number }}` for Feature Issue `#${{ github.event.inputs.feature_issue_number }}`. Follow these instructions exactly.

## Inputs

- **Feature Issue**: `#${{ github.event.inputs.feature_issue_number }}`
- **Spec directory**: `${{ github.event.inputs.spec_directory }}`
- **Merged spec PR**: `#${{ github.event.inputs.pr_number }}`

## Step 1 — Read tasks.md

Call `get_file_contents("${{ github.event.inputs.spec_directory }}/tasks.md", "main")` to read the task breakdown on the main branch.

Parse the **Markdown checklist format**:
- Tasks are lines matching `- [ ] T{NNN}: Title` or `- [x] T{NNN}: Title`
- Indented lines below a task checkpoint are part of that task's description
- Extract for each task: `id` (e.g. `T001`), `title` (text after the colon, trimmed), `description` (all indented continuation lines, joined with newlines)
- Include ALL tasks regardless of their checked/unchecked status

If `tasks.md` does not exist (404), post a comment on Feature Issue `#${{ github.event.inputs.feature_issue_number }}` explaining the file was not found, and then call `create_task_issues` with `tasks_json: "[]"`, `feature_issue_number: "${{ github.event.inputs.feature_issue_number }}"`, `spec_directory: "${{ github.event.inputs.spec_directory }}"`, `pr_number: "${{ github.event.inputs.pr_number }}"`, `skipped_count: "0"`. Then exit.

## Step 2 — Idempotency Check

Call `issue_read(get_sub_issues, ${{ github.event.inputs.feature_issue_number }})` to list all current sub-issues on the Feature Issue.

Build a deduplicated task list:
- For each task parsed in Step 1, check if a sub-issue already exists with a **case-insensitive, whitespace-normalised title match**
- If a match is found, mark the task as skipped (do not include in the `tasks_json` output)
- Count the number of skipped tasks

## Step 3 — Emit Task Creation Request

Call the `create_task_issues` safe-output with:
- `tasks_json`: a JSON array of task objects for tasks that do NOT already have a matching sub-issue. Each object must have:
  - `id` (string, e.g. `"T001"`)
  - `title` (string, the task title)
  - `description` (string, the task description text)
- `feature_issue_number`: `"${{ github.event.inputs.feature_issue_number }}"`
- `spec_directory`: `"${{ github.event.inputs.spec_directory }}"`
- `pr_number`: `"${{ github.event.inputs.pr_number }}"`
- `skipped_count`: string form of the number of skipped tasks

**Do NOT post any other comment.** The safe-outputs job will post the completion summary.

## Error Handling

If any step fails unexpectedly, use `create_issue_comment` to post the following comment on Feature Issue `#${{ github.event.inputs.feature_issue_number }}`:

```markdown
## ❌ Post-Merge Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-run the `Create Task Issues` workflow from the Actions tab using the same inputs (`feature_issue_number`, `spec_directory`, `pr_number`) to retry. The idempotency check will skip any issues that were already created.

_Automated recovery comment — agentic-flow_
```

Ensure the workflow exits with a clear error state.
