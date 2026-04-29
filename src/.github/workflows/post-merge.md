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
      merge_commit_sha:
        description: Merge commit SHA for deterministic tasks.md fetch
        required: false
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
      description: Fetches tasks.md, parses tasks, creates sub-issues, and links them to the Feature Issue. Fully self-contained — does not depend on agent-produced JSON.
      output: Task issue creation completed.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        issues: write
        contents: read
      inputs:
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
        merge_commit_sha:
          description: Merge commit SHA for deterministic tasks.md fetch.
          required: false
          type: string
      steps:
        - name: Create task issues and link sub-issues
          uses: actions/github-script@v8
          env:
            FEATURE_ISSUE_NUMBER: ${{ inputs.feature_issue_number }}
            SPEC_DIRECTORY: ${{ inputs.spec_directory }}
            PR_NUMBER: ${{ inputs.pr_number }}
            MERGE_COMMIT_SHA: ${{ inputs.merge_commit_sha }}
          with:
            github-token: ${{ github.token }}
            script: |
              const fail = message => { throw new Error(message); };
              const owner = context.repo.owner;
              const repo = context.repo.repo;

              const featureIssueNumber = parseInt(process.env.FEATURE_ISSUE_NUMBER, 10);
              if (!Number.isFinite(featureIssueNumber) || featureIssueNumber < 1) {
                fail(`Invalid feature_issue_number: ${JSON.stringify(process.env.FEATURE_ISSUE_NUMBER)}`);
              }

              const specDirectory = String(process.env.SPEC_DIRECTORY ?? "").trim();
              if (!/^specs\/[0-9]{3}-[a-z0-9][a-z0-9-]*$/.test(specDirectory)) {
                fail(`Invalid spec_directory: ${JSON.stringify(specDirectory)}`);
              }

              const prNumber = String(process.env.PR_NUMBER ?? "").trim();
              const ref = (process.env.MERGE_COMMIT_SHA ?? "").trim() || "main";

              // --- Helper: strip markdown formatting from text (safe for filenames) ---
              function stripMarkdown(text) {
                return text
                  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
                  .replace(/`([^`]+)`/g, '$1')                 // `code` → code
                  .replace(/\*\*([^*]+)\*\*/g, '$1')           // **bold** → bold
                  .replace(/__([^_]+)__/g, '$1')               // __bold__ → bold
                  .replace(/\s+/g, ' ')
                  .trim();
              }

              // --- Fetch tasks.md directly from the repo (authoritative source) ---
              const tasksPath = `${specDirectory}/tasks.md`;
              let markdown;
              try {
                const resp = await github.rest.repos.getContent({ owner, repo, path: tasksPath, ref });
                if (resp.data.type !== "file" || !resp.data.content) {
                  fail(`${tasksPath} is not a file or has no content`);
                }
                markdown = Buffer.from(resp.data.content, "base64").toString("utf8");
              } catch (e) {
                if (e.status === 404) {
                  await github.rest.issues.createComment({
                    owner, repo,
                    issue_number: featureIssueNumber,
                    body: `## ⚠️ Post-Merge Warning\n\n\`${tasksPath}\` was not found at ref \`${ref}\`. No task sub-issues were created.\n\n_Post-merge automation — agentic-flow_`
                  });
                  core.warning(`${tasksPath} not found (404) — skipping issue creation`);
                  return;
                }
                fail(`Failed to fetch ${tasksPath} at ref ${ref}: ${e.message}`);
              }

              // --- Parse within-phase dependencies from tasks.md ---
              function parseDependencies(md) {
                const deps = new Map();
                const tableMatch = md.match(/#+\s*Within-Phase Dependencies[\s\S]*?\n((?:\|.*\n)+)/);
                if (!tableMatch) return deps;
                const rows = tableMatch[1].split('\n').filter(r => r.startsWith('|'));
                for (const row of rows) {
                  const cells = row.split('|').map(c => c.trim()).filter(Boolean);
                  if (cells.length < 2) continue;
                  if (/^-+$/.test(cells[0].replace(/\s/g, '')) || /phase/i.test(cells[0])) continue;
                  const constraints = cells[cells.length - 1] || '';
                  for (const clause of constraints.split(';')) {
                    const m = clause.match(/(.+?)\s+before\s+(.+)/i);
                    if (!m) continue;
                    const prereqs = [...m[1].matchAll(/T(\d{3})/g)].map(x => `T${x[1]}`);
                    const targets = [...m[2].matchAll(/T(\d{3})/g)].map(x => `T${x[1]}`);
                    for (const target of targets) {
                      if (!deps.has(target)) deps.set(target, new Set());
                      for (const prereq of prereqs) deps.get(target).add(prereq);
                    }
                  }
                }
                return deps;
              }

              // --- Parse tasks.md markdown into task objects + phase checkpoints ---
              function parseTasksMd(md) {
                const lines = md.split("\n");
                const tasks = [];
                let current = null;
                let currentPhase = "";
                const phaseCheckpoints = new Map();
                let collectingCheckpoint = null;

                for (const line of lines) {
                  if (/^##\s+Phase\s+\d+/.test(line)) {
                    currentPhase = line.replace(/^##\s+/, "").trim();
                    if (current) { tasks.push(current); current = null; }
                    collectingCheckpoint = null;
                    continue;
                  }

                  const cpMatch = line.match(/^\*\*(?:Checkpoint|Independent Test)\*\*:\s*(.*)/);
                  if (cpMatch && currentPhase) {
                    collectingCheckpoint = currentPhase;
                    const existing = phaseCheckpoints.get(currentPhase) || '';
                    phaseCheckpoints.set(currentPhase,
                      (existing ? existing + '\n' : '') + cpMatch[1].trim());
                    continue;
                  }
                  if (collectingCheckpoint && line.trim() !== ''
                      && !line.startsWith('#') && !line.startsWith('- [') && !line.startsWith('|')) {
                    const prev = phaseCheckpoints.get(collectingCheckpoint) || '';
                    phaseCheckpoints.set(collectingCheckpoint, prev + ' ' + line.trim());
                    continue;
                  }
                  if (collectingCheckpoint &&
                      (line.trim() === '' || line.startsWith('#') || line.startsWith('- [') || line.startsWith('|'))) {
                    collectingCheckpoint = null;
                  }

                  const m = line.match(/^- \[[ x]\] (T\d{3})\b[\s:]*(.+)/);
                  if (m) {
                    if (current) tasks.push(current);
                    collectingCheckpoint = null;
                    const raw = m[2];

                    const parallel = /\[P\]/.test(raw);
                    const storyMatch = raw.match(/\[US(\d+)\]/);
                    const story = storyMatch ? `US${storyMatch[1]}` : "";

                    const fileMatch = raw.match(/\s*—\s*(`[^`]+`(?:,\s*`[^`]+`)*)\s*$/);
                    const file = fileMatch ? fileMatch[1] : "";

                    const stripped = raw
                      .replace(/^(\[(?:P|US\d+)\]\s*)+/, "")
                      .replace(/\s*—\s*`[^`]+`(?:,\s*`[^`]+`)*\s*$/, "")
                      .trim();

                    const dashIdx = stripped.indexOf(" — ");
                    let shortTitle, detail;
                    if (dashIdx > 0) {
                      shortTitle = stripped.substring(0, dashIdx).trim();
                      detail = stripped.substring(dashIdx + 3).trim();
                    } else {
                      shortTitle = stripped;
                      detail = "";
                    }

                    const refs = [...new Set(
                      (stripped.match(/T\d{3}/g) || []).filter(r => r !== m[1])
                    )];

                    current = {
                      id: m[1], title: shortTitle, detail, description: "",
                      phase: currentPhase, file, parallel, story, refs,
                    };
                    continue;
                  }
                  if (current && /^  /.test(line) && line.trim() !== "") {
                    current.description += (current.description ? "\n" : "") + line.trimEnd();
                  } else if (current && line.trim() === "") {
                    // blank line — keep task open
                  } else if (current && !/^  /.test(line) && line.trim() !== "") {
                    tasks.push(current);
                    current = null;
                  }
                }
                if (current) tasks.push(current);
                return { tasks, phaseCheckpoints };
              }

              const { tasks: allTasks, phaseCheckpoints } = parseTasksMd(markdown);
              const withinPhaseDeps = parseDependencies(markdown);
              core.info(`Parsed ${allTasks.length} tasks from ${tasksPath}`);

              if (allTasks.length === 0) {
                await github.rest.issues.createComment({
                  owner, repo,
                  issue_number: featureIssueNumber,
                  body: `## ⚠️ Post-Merge Warning\n\nNo tasks were found in \`${tasksPath}\`. No task sub-issues were created.\n\n_Post-merge automation — agentic-flow_`
                });
                core.warning("No tasks found in tasks.md — skipping issue creation");
                return;
              }

              // --- Idempotency check: skip tasks with matching sub-issues ---
              const existingTaskIds = new Set();
              const existingTitles = new Set();
              const taskIdToIssueNumber = new Map();
              const normalize = s => s.trim().toLowerCase().replace(/\s+/g, " ");
              try {
                const subIssues = await github.request(
                  "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
                  { owner, repo, issue_number: featureIssueNumber, per_page: 100 }
                );
                for (const si of subIssues.data) {
                  existingTitles.add(normalize(si.title || ""));
                  const bodyId = (si.body || "").match(/\*\*Task(?:\s*ID)?\*\*[:\s]*(T\d{3})/);
                  if (bodyId) {
                    existingTaskIds.add(bodyId[1]);
                    taskIdToIssueNumber.set(bodyId[1], si.number);
                  }
                  const titleId = (si.title || "").match(/^(T\d{3}):/);
                  if (titleId) {
                    existingTaskIds.add(titleId[1]);
                    taskIdToIssueNumber.set(titleId[1], si.number);
                  }
                }
              } catch (e) {
                core.warning(`Could not fetch sub-issues for #${featureIssueNumber}: ${e.message}`);
              }

              const newTasks = allTasks.filter(t =>
                !existingTaskIds.has(t.id) &&
                !existingTitles.has(normalize(`${t.id}: ${stripMarkdown(t.title)}`))
              );
              const skippedCount = allTasks.length - newTasks.length;
              if (skippedCount > 0) {
                core.info(`Skipped ${skippedCount} tasks (matching sub-issues already exist)`);
              }

              if (newTasks.length === 0) {
                await github.rest.issues.createComment({
                  owner, repo,
                  issue_number: featureIssueNumber,
                  body: [
                    "## ✅ Task Sub-Issues — Already Complete",
                    "",
                    `All ${allTasks.length} tasks from \`${tasksPath}\` already have matching sub-issues. No new issues created.`,
                    "",
                    "_Post-merge automation — agentic-flow_",
                  ].join("\n"),
                });
                return;
              }

              // --- Build spec/plan/tasks permalink URLs ---
              const specLink = `https://github.com/${owner}/${repo}/blob/${ref}/${specDirectory}/spec.md`;
              const planLink = `https://github.com/${owner}/${repo}/blob/${ref}/${specDirectory}/plan.md`;
              const tasksLink = `https://github.com/${owner}/${repo}/blob/${ref}/${tasksPath}`;

              // --- Audit task detection ---
              const auditPattern = /^(audit|review|verify|validate)\b/i;

              // --- Create task issues and link as sub-issues ---
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              const created = [];
              const failures = [];

              for (const task of newTasks) {
                if (!task.title || typeof task.title !== "string") {
                  core.warning(`Skipping task with missing or invalid title: ${JSON.stringify(task)}`);
                  continue;
                }

                const descParts = [];
                if (task.detail) descParts.push(task.detail);
                if (task.description) descParts.push(task.description);
                const fullDesc = descParts.join("\n\n");

                // Verification section from phase checkpoint
                const checkpoint = phaseCheckpoints.get(task.phase) || '';
                const verificationSection = checkpoint
                  ? `\n\n## Verification\n\n${checkpoint}`
                  : '';

                // Resolve dependencies to issue numbers
                const taskDeps = withinPhaseDeps.get(task.id) || new Set();
                const depIssueRefs = [];
                const unresolvedDeps = [];
                for (const depId of taskDeps) {
                  const issueNum = taskIdToIssueNumber.get(depId);
                  if (issueNum) {
                    depIssueRefs.push(`#${issueNum} (${depId})`);
                  } else {
                    unresolvedDeps.push(depId);
                  }
                }

                // Metadata table
                const metaRows = [];
                if (task.file) metaRows.push(`| **File** | ${task.file} |`);
                if (task.phase) metaRows.push(`| **Phase** | ${task.phase} |`);
                if (task.story) metaRows.push(`| **Story** | ${task.story} |`);
                if (task.parallel) metaRows.push("| **Parallel** | ✅ |");
                if (depIssueRefs.length > 0) {
                  metaRows.push(`| **Depends on** | ${depIssueRefs.join(', ')} |`);
                }
                if (unresolvedDeps.length > 0) {
                  metaRows.push(`| **Also depends on** | ${unresolvedDeps.join(', ')} (not yet created) |`);
                }
                const metaTable = metaRows.length > 0
                  ? `\n\n| | |\n|---|---|\n${metaRows.join("\n")}`
                  : "";

                const body = [
                  fullDesc + verificationSection + metaTable,
                  "",
                  "---",
                  `📋 [spec.md](${specLink}) · [plan.md](${planLink}) · [tasks.md](${tasksLink}) · **Feature**: #${featureIssueNumber} · **Task**: ${task.id}`,
                ].join("\n").trim();

                const cleanTitle = stripMarkdown(task.title);
                const issueTitle = `${task.id}: ${cleanTitle}`.trim();
                const isAudit = auditPattern.test(cleanTitle);
                const labels = ["agentic-flow-task"];
                if (isAudit) labels.push("agentic-flow-audit");

                const issue = await github.rest.issues.create({
                  owner, repo,
                  title: issueTitle,
                  body,
                  labels,
                });

                created.push({
                  number: issue.data.number,
                  title: cleanTitle,
                  taskId: task.id,
                  id: issue.data.id,
                });
                taskIdToIssueNumber.set(task.id, issue.data.number);

                try {
                  await github.request(
                    "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
                    { owner, repo, issue_number: featureIssueNumber, sub_issue_id: issue.data.id }
                  );
                } catch (e) {
                  core.warning(`Sub-issue link failed for #${issue.data.number}: ${e.message}`);
                  failures.push(`#${issue.data.number}: ${e.message}`);
                }

                await sleep(newTasks.length > 20 ? 1000 : 500);
              }

              // --- Summary comment ---
              const issueList = created.map(i => `- #${i.number}: ${i.taskId} — ${i.title}`).join("\n");
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
                  `**Tasks processed**: ${allTasks.length}`,
                  `**New task issues created**: ${created.length}`,
                  `**Already existed (skipped)**: ${skippedCount}`,
                  "",
                  issueList,
                  failureNote,
                  "",
                  "_Post-merge automation — agentic-flow_",
                ].join("\n").trim(),
              });

              // --- Label cleanup: only when all tasks created and linked successfully ---
              if (failures.length === 0) {
                const pipelineLabels = [
                  'needs-spec', 'needs-refinement', 'research-in-progress',
                  'research-complete', 'spec-in-progress', 'ready-to-merge',
                ];
                for (const label of pipelineLabels) {
                  try {
                    await github.rest.issues.removeLabel({
                      owner, repo,
                      issue_number: featureIssueNumber,
                      name: label,
                    });
                  } catch (e) {
                    if (e.status !== 404) {
                      core.warning(`Failed to remove label '${label}': ${e.message}`);
                    }
                  }
                }
                try {
                  await github.rest.issues.addLabels({
                    owner, repo,
                    issue_number: featureIssueNumber,
                    labels: ['tasks-created'],
                  });
                } catch (e) {
                  core.warning(`Failed to add 'tasks-created' label: ${e.message}`);
                }
              }

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
- **Merge commit SHA**: `${{ github.event.inputs.merge_commit_sha }}`

## Step 1 — Verify tasks.md exists

Call `get_file_contents` to read `${{ github.event.inputs.spec_directory }}/tasks.md` at ref `${{ github.event.inputs.merge_commit_sha || 'main' }}`.

If the file does not exist (404), post a comment on Feature Issue `#${{ github.event.inputs.feature_issue_number }}` explaining the file was not found, then call `create_task_issues` with `feature_issue_number: "${{ github.event.inputs.feature_issue_number }}"`, `spec_directory: "${{ github.event.inputs.spec_directory }}"`, `pr_number: "${{ github.event.inputs.pr_number }}"`, `merge_commit_sha: "${{ github.event.inputs.merge_commit_sha }}"`. Then exit.

## Step 2 — Emit Task Creation Request

Call the `create_task_issues` safe-output with:
- `feature_issue_number`: `"${{ github.event.inputs.feature_issue_number }}"`
- `spec_directory`: `"${{ github.event.inputs.spec_directory }}"`
- `pr_number`: `"${{ github.event.inputs.pr_number }}"`
- `merge_commit_sha`: `"${{ github.event.inputs.merge_commit_sha }}"`

**IMPORTANT**: Do NOT attempt to parse tasks.md into JSON. The safe-output job fetches and parses the file directly. Your only job is to verify the file exists and pass through the inputs.

**Do NOT post any other comment.** The safe-outputs job will post the completion summary.

## Error Handling

If any step fails unexpectedly, use `create_issue_comment` to post the following comment on Feature Issue `#${{ github.event.inputs.feature_issue_number }}`:

```markdown
## ❌ Post-Merge Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-run the `Create Task Issues` workflow from the Actions tab using the same inputs (`feature_issue_number`, `spec_directory`, `pr_number`, `merge_commit_sha`) to retry. The idempotency check will skip any issues that were already created.

_Automated recovery comment — agentic-flow_
```

Ensure the workflow exits with a clear error state.
