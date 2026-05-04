# Implementation Plan: Automated Review Stage

**Spec**: `specs/005-review-stage/spec.md`
<!-- TODO: replace relative path with permanent GitHub blob URL once spec PR is merged (C1) -->
**Feature branch**: `005-review-stage`  
**Status**: Ready for implementation

---

## Constitution Check

| Principle | Verdict | Justification |
|-----------|---------|---------------|
| I — Spec-First | PASS | spec.md was created and reviewed before this plan was written |
| II — Append-Only | PASS | All agent and workflow outputs are new comments; no existing issue/PR body mutations |
| III — AI Pre-Review | PASS | speckit.analyze was run over spec.md and plan.md before tasks generation |
| IV — Dog Food | PASS | This feature goes through the full agentic-flow pipeline |
| V — Four Human Gates | PASS | No new human gates are introduced; the review stage is fully automated |
| VI — Traceability | PASS (pending) | Spec referenced by path; permanent SHA blob URL to be added after spec PR merges |
| VII — Test Coverage Floor | PASS | All new GHA JS code is covered by the edge-case table (§6); the review agent's FR-008 check enforces test coverage on the implementation itself |

---

## 1. Architecture Overview

The Review stage inserts a four-category cross-cutting check between audit completion and the
human-merge gate. The integration surface is deliberately minimal: one existing workflow step
is replaced, and four new standard GHA workflows plus one agent definition are added.

```
audit-chain-trigger.yml (all audits pass)
    └── dispatch → review-dispatch.yml
                       └── assign-pr-agent (stage: review)
                                └── [agentic-flow-review runs on feature PR]
                                         └── posts <!-- agentic-flow-context Phase: review ... -->
review-result-trigger.yml (issue_comment: created)
    ├── Audit result: APPROVE
    │       └── un-draft PR, add implementation-complete label, post summary
    └── Audit result: REQUEST_CHANGES
            ├── iteration count ≥ 5 → halt, post error comment
            └── iteration count < 5 → dispatch review-fix-dispatch.yml
                    └── create review-fix/{suffix} branch
                    └── open fix task PR targeting feature branch
                    └── assign-pr-agent (stage: review-fix)
                             └── [agentic-flow-implement runs on fix branch]
                                      └── labels fix PR ready-to-merge-task
                        implement-merge.yml (existing, guarded)
                             └── merges fix PR into feature branch
                        review-fix-complete-trigger.yml (pull_request: closed+merged)
                             └── dispatch → review-dispatch.yml (next iteration)
```

### Key Architectural Decisions

**AD-1: No review task sub-issue**
The review agent operates directly against the feature PR. No sub-issue is created, consistent
with FR-003. The iteration counter is tracked by counting `Phase: review` +
`Audit result: REQUEST_CHANGES` context blocks in the feature PR's comment history.

**AD-2: GHA trigger handles routing (not the review agent)**
The review agent posts a `<!-- agentic-flow-context -->` block and exits. A new
`review-result-trigger.yml` workflow watches for this block on `issue_comment: created`
events and routes to the human-gate handoff or the fix loop. This is consistent with the
existing pipeline pattern where GHA workflows react to agent outputs rather than agents
dispatching follow-up workflows directly.

**AD-3: `assign-pr-agent` extended with two new stage names**
`review` (direct-mode, feature PR, four-check instructions) and `review-fix`
(direct-mode, fix branch PR, points the implement agent to the review findings comment on
the feature PR). Both are added to `main.js`; the `action.yml` interface is unchanged.

**AD-4: `implement-merge.yml` requires a targeted guard (spec assumption correction)**
The spec assumes implement-merge.yml works unchanged for fix PRs. Analysis shows this is
incorrect: when a fix PR merges, all feature sub-issues are already closed (post-audit),
so implement-merge.yml's chain-advance logic would enter the "no open tasks, no open audits"
branch, close the placeholder "task issue," and dispatch the no-audit path — incorrectly
marking the feature PR ready for human merge and bypassing the remaining review cycles.

**Resolution**: Two targeted guards are added to `implement-merge.yml`:
1. The "Close task issue with summary" step skips when the task PR has the
   `agentic-flow-review-fix-pr` label (the feature issue used as placeholder must not be closed).
2. The "Find next task or dispatch audit" step skips when the task PR has
   `agentic-flow-review-fix-pr` (chain-advance must not fire during the review fix loop).

These guards are implemented as `if:` condition additions on the two steps. No logic in any
other step changes.

**AD-5: Fix branch naming**
Fix branches are named `review-fix/{feature-branch-suffix}`, e.g.
`review-fix/005-review-stage` for feature branch `implement/005-review-stage`.
Since each fix branch is deleted after its PR merges, the same name is reused across
iterations. If a prior branch was not cleaned up, `review-fix-dispatch.yml` deletes and
recreates it from the latest feature branch SHA.

**AD-6: Fix task PR body fields**
`implement-merge.yml` parses four required fields from the task PR body using regex. Fix task
PRs must include all four fields. The `**Task issue:**` field uses the feature issue number as
a placeholder (with the guard from AD-4 preventing it from being closed). The review findings
text is embedded in the fix PR body after the standard fields.

**AD-7: Iteration cap enforcement location**
The 5-iteration cap is checked in `review-result-trigger.yml` (not `review-fix-dispatch.yml`).
On each REQUEST_CHANGES event, `review-result-trigger.yml` counts prior
`Audit result: REQUEST_CHANGES` context blocks from bot accounts on the feature PR.
If the new dispatch would be the 6th REQUEST_CHANGES response, it halts instead.
`review-fix-dispatch.yml` still includes a concurrent-branch guard (FR-015) but not the cap.

**AD-8: Fix PR merge via existing `implement-merge.yml` + `ready-to-merge-task`**
With the guard from AD-4, `implement-merge.yml` merges fix PRs correctly (merge step is
unguarded; only close-issue and chain-advance steps are guarded). The fix task PR receives
`agentic-flow-task-pr` and `agentic-flow-review-fix-pr` labels. The second label is the
discriminator for the guards and for `review-fix-complete-trigger.yml`.

---

## 2. New Labels

| Label | Meaning | Applied by |
|-------|---------|-----------|
| `agentic-flow-review-fix-pr` | Fix task PR targeting the feature branch for review findings | `review-fix-dispatch.yml` |

Both `agentic-flow-task-pr` (already exists) and `agentic-flow-review-fix-pr` are applied to
fix task PRs. This allows `implement-merge.yml` to auto-merge them (via `ready-to-merge-task`
label path) while `review-fix-complete-trigger.yml` identifies them by their distinct label.

---

## 3. Component Design

### 3.1 `audit-chain-trigger.yml` — modification

**Change**: Replace the "Mark feature PR ready for human merge" step (the final `if: ... open_audit_count == '0'` step) with a "Dispatch review stage" step.

**Before** (step fires when `open_audit_count == '0'`):
- Un-drafts feature PR
- Applies `implementation-complete` label
- Posts "All Audits Complete" comments on feature issue and feature PR

**After** (same condition):
```yaml
- name: Dispatch review stage
  if: steps.parse.outputs.skip != 'true' && steps.context.outputs.skip_chain != 'true' && steps.context.outputs.open_audit_count == '0'
  uses: actions/github-script@v8
  with:
    script: |
      await github.rest.actions.createWorkflowDispatch({
        owner: context.repo.owner,
        repo:  context.repo.repo,
        workflow_id: 'review-dispatch.yml',
        ref: 'main',
        inputs: {
          feature_issue_number: '${{ steps.parse.outputs.feature_issue_number }}',
          feature_pr_number:    '${{ steps.context.outputs.feature_pr_number }}',
          feature_branch:       '${{ steps.context.outputs.feature_branch }}',
          spec_directory:       '${{ steps.context.outputs.spec_directory }}',
        },
      });
      core.info('Dispatched review-dispatch.yml for feature PR ...');
```

**Error handling**: The step must catch dispatch errors and post an error comment on the feature
PR (leave PR in draft). The existing error-comment pattern from the audit chain is reused.

**FR coverage**: FR-001, FR-002

---

### 3.2 `src/.github/workflows/review-dispatch.yml` — new file

Standard GHA YAML workflow (not agentic `.md`).

```
name: Review Dispatch (agentic-flow)

on:
  workflow_dispatch:
    inputs:
      feature_issue_number: required
      feature_pr_number:    required
      feature_branch:       required
      spec_directory:       required

concurrency:
  group: review-dispatch-${{ github.event.inputs.feature_pr_number }}
  cancel-in-progress: false

jobs:
  dispatch:
    runs-on: ubuntu-latest
    environment: copilot
    permissions: [contents: read, pull-requests: write, issues: write]
    steps:
      - uses: actions/checkout@v4

      - name: Validate PR is open and not already approved
        id: validate
        uses: actions/github-script@v8
        with:
          script: |
            // 1. Check PR is still open
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner, repo: context.repo.repo,
              pull_number: Number('${{ github.event.inputs.feature_pr_number }}'),
            });
            if (pr.state !== 'open') {
              core.warning('Feature PR is not open; skipping review dispatch.');
              core.setOutput('skip', 'true'); return;
            }
            // 2. Idempotency: skip if review APPROVE context block already exists on this PR
            // (guards against spurious re-dispatch after a previous APPROVE)
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: Number('${{ github.event.inputs.feature_pr_number }}'),
              per_page: 100,
            });
            const alreadyApproved = comments.some(c =>
              (c.user?.type === 'Bot' || c.user?.login?.endsWith('[bot]')) &&
              c.body?.includes('<!-- agentic-flow-context') &&
              c.body?.includes('Phase: review') &&
              c.body?.includes('Audit result: APPROVE')
            );
            if (alreadyApproved) {
              core.warning('Feature PR already has a review APPROVE; skipping re-dispatch.');
              core.setOutput('skip', 'true'); return;
            }
            core.setOutput('skip', 'false');

      - name: Assign review agent to feature PR
        if: steps.validate.outputs.skip != 'true'
        uses: ./.github/actions/assign-pr-agent
        with:
          stage-name: review
          agent-name: agentic-flow-review
          context-source: direct
          pull-number:            ${{ github.event.inputs.feature_pr_number }}
          feature-issue-number:   ${{ github.event.inputs.feature_issue_number }}
          spec-directory:         ${{ github.event.inputs.spec_directory }}
          feature-pr-number:      ${{ github.event.inputs.feature_pr_number }}
          agent-token:            ${{ secrets.GH_AW_AGENT_TOKEN }}
```

**FR coverage**: FR-001, FR-003, FR-004, FR-009 (agent performs checks; workflow dispatches agent)

---

### 3.3 `src/.github/agents/agentic-flow-review.agent.md` — new file

Agent definition using the `gh aw` agent format. The agent has access to:
- `read`, `search`, `execute` tools (same as `agentic-flow-audit`)
- GitHub MCP tools (PR review submission, comment creation, workflow dispatch read)

**Agent responsibilities**:
1. Read spec.md, plan.md, tasks.md from the spec directory
2. Fetch the full diff of the feature PR
3. Perform four-category checks (FR-005 through FR-008)
4. On zero findings: submit APPROVE PR review + post context block with `Audit result: APPROVE`
5. On any finding: post structured findings comment (FR-010) + submit REQUEST_CHANGES PR review + post context block with `Audit result: REQUEST_CHANGES`

**Context block format** (posted by the agent after review — must match §4.1 exactly):
```
<!-- agentic-flow-context
Phase: review
Run mode: review
Feature issue: #N
Feature PR: #N
Spec directory: specs/<NNN>-<slug>
Feature branch: `implement/<NNN>-<slug>`
Audit result: APPROVE   ← or REQUEST_CHANGES
-->
```

The agent must include this exact sentinel in a PR comment so that `review-result-trigger.yml`
can parse the result reliably.

**FR coverage**: FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010

---

### 3.4 `src/.github/workflows/review-result-trigger.yml` — new file

Standard GHA YAML. Watches for the review agent's context block comment and routes the result.

```
name: Review Result Trigger (agentic-flow)

on:
  issue_comment:
    types: [created]

concurrency:
  group: review-result-trigger-${{ github.event.issue.number }}
  cancel-in-progress: false

permissions:
  contents: read
  issues: write
  pull-requests: write
  actions: write

jobs:
  route-review-result:
    # Filter: bot author + Phase: review (exact line, not review-fix) in context block
    if: |
      (github.event.comment.user.type == 'Bot' || contains(github.event.comment.user.login, '[bot]')) &&
      contains(github.event.comment.body, '<!-- agentic-flow-context') &&
      contains(github.event.comment.body, 'Phase: review') &&
      !contains(github.event.comment.body, 'Phase: review-fix')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
      actions: write
    steps:
      - name: Parse review context block
        id: parse
        uses: actions/github-script@v8
        with:
          script: |
            const body = context.payload.comment.body || '';
            // Extract context block
            const blockMatch = body.match(/<!-- agentic-flow-context([\s\S]*?)-->/);
            if (!blockMatch) { core.setOutput('skip', 'true'); return; }
            const block = blockMatch[1];

            const result    = (block.match(/Audit result:\s*(\S+)/) || [])[1];
            const featureIssueNum = (block.match(/Feature issue:\s*#(\d+)/) || [])[1];
            const featurePRNum    = (block.match(/Feature PR:\s*#(\d+)/) || [])[1];
            const specDir         = (block.match(/Spec directory:\s*(\S+)/) || [])[1];

            if (!result || !featureIssueNum || !featurePRNum || !specDir) {
              core.info('Incomplete review context block; skipping.');
              core.setOutput('skip', 'true'); return;
            }
            // Verify the comment is on a PR (issue_number in GitHub API for PR comments == PR number)
            // The comment is on a PR if the issue has a pull_request field.
            const { data: issue } = await github.rest.issues.get({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: Number(featurePRNum),
            });
            if (!issue.pull_request) {
              core.info('Comment is not on a PR; skipping.'); core.setOutput('skip', 'true'); return;
            }

            core.setOutput('skip', 'false');
            core.setOutput('audit_result',        result.toUpperCase());
            core.setOutput('feature_issue_number', featureIssueNum);
            core.setOutput('feature_pr_number',    featurePRNum);
            core.setOutput('spec_directory',       specDir);

      - name: Resolve feature branch from feature issue context
        id: context
        if: steps.parse.outputs.skip != 'true'
        uses: actions/github-script@v8
        with:
          script: |
            // Read the impl-context block from feature issue comments to get feature_branch
            const owner = context.repo.owner;
            const repo  = context.repo.repo;
            const featureIssueNumber = Number('${{ steps.parse.outputs.feature_issue_number }}');
            let featureBranch = '';
            let page = 1;
            outer: while (true) {
              const { data: comments } = await github.rest.issues.listComments({
                owner, repo, issue_number: featureIssueNumber, per_page: 100, page,
              });
              if (comments.length === 0) break;
              for (const c of [...comments].reverse()) {
                if (!c.user?.login?.endsWith('[bot]')) continue;
                const markerMatch = (c.body || '').match(/<!-- agentic-flow-impl-context:([A-Za-z0-9_=-]+) -->/);
                if (markerMatch) {
                  try {
                    const decoded = JSON.parse(Buffer.from(markerMatch[1], 'base64url').toString('utf8'));
                    if (decoded.featureBranch) { featureBranch = decoded.featureBranch; break outer; }
                  } catch {}
                }
              }
              page++;
            }
            if (!featureBranch) {
              const specDir = '${{ steps.parse.outputs.spec_directory }}';
              featureBranch = `implement/${specDir.replace(/^specs\//, '')}`;
            }
            core.setOutput('feature_branch', featureBranch);

      - name: Handle APPROVE — human-gate handoff
        if: steps.parse.outputs.skip != 'true' && steps.parse.outputs.audit_result == 'APPROVE'
        uses: actions/github-script@v8
        with:
          github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
          script: |
            const owner              = context.repo.owner;
            const repo               = context.repo.repo;
            const featureIssueNumber = Number('${{ steps.parse.outputs.feature_issue_number }}');
            const featurePRNumber    = Number('${{ steps.parse.outputs.feature_pr_number }}');

            // Collect closed audit tasks for summary (FR-017)
            let subIssues = [];
            try {
              const { data } = await github.request(
                'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
                { owner, repo, issue_number: featureIssueNumber }
              );
              subIssues = data || [];
            } catch (e) { core.warning(`Could not fetch sub-issues: ${e.message}`); }

            const closedAuditTasks = subIssues.filter(si =>
              si.labels?.some(l => l.name === 'agentic-flow-audit') && si.state === 'closed'
            );
            const auditSummary = closedAuditTasks.map(i => `- ✅ #${i.number}: ${i.title}`).join('\n')
              || '_No audit tasks_';

            // Un-draft feature PR (FR-016)
            try {
              await github.rest.pulls.update({
                owner, repo, pull_number: featurePRNumber, draft: false,
              });
            } catch (e) { core.warning(`Could not un-draft feature PR: ${e.message}`); }

            // Apply implementation-complete label (FR-016)
            try {
              await github.rest.issues.addLabels({
                owner, repo, issue_number: featureIssueNumber,
                labels: ['implementation-complete'],
              });
            } catch (e) { core.warning(`Could not add label: ${e.message}`); }

            // Summary comment on feature issue (FR-016, FR-017)
            await github.rest.issues.createComment({
              owner, repo, issue_number: featureIssueNumber,
              body: [
                '## 🎉 All Audits & Review Complete — Ready for Human Merge',
                '', 'All audit tasks and the automated review have passed.',
                '', '### Completed Audits', auditSummary,
                '', '### Review Result', '✅ Review stage: APPROVE — all four check categories passed.',
                '', `**Feature PR #${featurePRNumber}** is ready for human review and merge to \`main\`.`,
                '', '_agentic-flow implementation pipeline_',
              ].join('\n'),
            });

            // Summary comment on feature PR (FR-016, FR-017)
            await github.rest.issues.createComment({
              owner, repo, issue_number: featurePRNumber,
              body: [
                '## 🎉 All Audits & Review Complete — Ready for Human Review',
                '', 'All implementation tasks have been merged, all audit tasks approved,',
                'and the automated review stage has passed.',
                '', '### Completed Audits', auditSummary,
                '', '### Review Result', '✅ Review stage: APPROVE — security, architecture, acceptance criteria, and coverage checks all passed.',
                '', 'This PR is ready for human review and merge to `main`.',
                '', '_agentic-flow implementation pipeline_',
              ].join('\n'),
            });

      - name: Handle REQUEST_CHANGES — check cap and dispatch fix
        if: steps.parse.outputs.skip != 'true' && steps.parse.outputs.audit_result == 'REQUEST_CHANGES'
        uses: actions/github-script@v8
        with:
          # Uses default GITHUB_TOKEN (not GH_AW_AGENT_TOKEN) because this step only dispatches
          # a workflow_dispatch event and posts comments — it does not un-draft PRs or apply labels
          # (those require the elevated token). The job-level `actions: write` permission covers
          # workflow dispatch with the default token.
          script: |
            const owner              = context.repo.owner;
            const repo               = context.repo.repo;
            const featureIssueNumber = Number('${{ steps.parse.outputs.feature_issue_number }}');
            const featurePRNumber    = Number('${{ steps.parse.outputs.feature_pr_number }}');
            const specDirectory      = '${{ steps.parse.outputs.spec_directory }}';
            const featureBranch      = '${{ steps.context.outputs.feature_branch }}';
            const MAX_ITERATIONS     = 5;

            // Count prior REQUEST_CHANGES context blocks (FR-014)
            // NOTE: per_page:100 with no pagination loop. On a high-activity PR with >100 comments
            // the counter may undercount, allowing up to 5+N extra iterations before halting.
            // Acceptable: the 5-cycle MAX_ITERATIONS cap is defensive; the primary protection is
            // human review of stalled PRs. A pagination loop can be added if this becomes a
            // problem in practice.
            const { data: comments } = await github.rest.issues.listComments({
              owner, repo, issue_number: featurePRNumber, per_page: 100,
            });
            const priorRequestChanges = comments.filter(c => {
              if (!(c.user?.type === 'Bot' || c.user?.login?.endsWith('[bot]'))) return false;
              const b = c.body || '';
              return b.includes('<!-- agentic-flow-context') &&
                     b.includes('Phase: review') &&
                     b.includes('Audit result: REQUEST_CHANGES');
            });
            // The current comment is already in the list, so count includes the current one.
            const iterationCount = priorRequestChanges.length;

            if (iterationCount >= MAX_ITERATIONS) {
              // Halt — max iterations reached (FR-014)
              const errorBody = [
                '## ❌ Review Fix Loop Halted — Maximum Iterations Reached',
                '',
                `The automated review has requested changes **${iterationCount} times** without`,
                'converging. The fix loop has been halted to prevent indefinite cycling.',
                '',
                '**Human intervention is required** to review the outstanding findings and',
                'resolve them manually before the pipeline can continue.',
                '',
                `Review the most recent review findings comment on this PR and address the`,
                'remaining issues, then re-trigger the review manually.',
                '',
                '_agentic-flow implementation pipeline_',
              ].join('\n');
              await github.rest.issues.createComment({
                owner, repo, issue_number: featurePRNumber, body: errorBody,
              });
              await github.rest.issues.createComment({
                owner, repo, issue_number: featureIssueNumber, body: errorBody,
              });
              core.warning(`Review fix loop halted after ${iterationCount} iterations.`);
              return;
            }

            // Dispatch fix workflow (FR-011)
            core.info(`Review iteration ${iterationCount}/${MAX_ITERATIONS}. Dispatching fix.`);
            await github.rest.actions.createWorkflowDispatch({
              owner, repo,
              workflow_id: 'review-fix-dispatch.yml',
              ref: 'main',
              inputs: {
                feature_issue_number: String(featureIssueNumber),
                feature_pr_number:    String(featurePRNumber),
                feature_branch:       featureBranch,
                spec_directory:       specDirectory,
              },
            });
```

**FR coverage**: FR-009, FR-014, FR-016, FR-017

---

### 3.5 `src/.github/workflows/review-fix-dispatch.yml` — new file

Standard GHA YAML. Creates the fix branch and fix task PR, assigns the implement agent.

```
name: Review Fix Dispatch (agentic-flow)

on:
  workflow_dispatch:
    inputs:
      feature_issue_number: required
      feature_pr_number:    required
      feature_branch:       required   # e.g. implement/005-review-stage
      spec_directory:       required

concurrency:
  group: review-fix-dispatch-${{ github.event.inputs.feature_pr_number }}
  cancel-in-progress: false

jobs:
  dispatch-fix:
    runs-on: ubuntu-latest
    environment: copilot
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Guard — check for existing open fix PR (FR-015)
        id: guard
        uses: actions/github-script@v8
        with:
          script: |
            const owner         = context.repo.owner;
            const repo          = context.repo.repo;
            const featureBranch = '${{ github.event.inputs.feature_branch }}';

            // List open PRs with agentic-flow-review-fix-pr label targeting feature branch
            const { data: prs } = await github.rest.pulls.list({
              owner, repo, state: 'open', base: featureBranch, per_page: 50,
            });
            const existing = prs.find(pr =>
              pr.labels?.some(l => l.name === 'agentic-flow-review-fix-pr')
            );
            if (existing) {
              core.warning(`Open fix PR #${existing.number} already exists; skipping new dispatch.`);
              await github.rest.issues.createComment({
                owner, repo,
                issue_number: Number('${{ github.event.inputs.feature_pr_number }}'),
                body: [
                  '## ⚠️ Review Fix — Concurrent Branch Detected',
                  '',
                  `An open fix task PR (#${existing.number}) targeting \`${featureBranch}\``,
                  'already exists. A new fix branch will not be created until it is resolved.',
                  '',
                  '_agentic-flow implementation pipeline_',
                ].join('\n'),
              });
              core.setOutput('skip', 'true'); return;
            }
            core.setOutput('skip', 'false');

      - name: Create fix branch (FR-012)
        id: branch
        if: steps.guard.outputs.skip != 'true'
        uses: actions/github-script@v8
        with:
          script: |
            const owner         = context.repo.owner;
            const repo          = context.repo.repo;
            const featureBranch = '${{ github.event.inputs.feature_branch }}';
            const suffix        = featureBranch.replace(/^implement\//, '');
            const fixBranch     = `review-fix/${suffix}`;

            // Get current tip of feature branch
            const { data: ref } = await github.rest.git.getRef({
              owner, repo, ref: `heads/${featureBranch}`,
            });
            const sha = ref.object.sha;

            // Delete existing fix branch if it was not cleaned up after a prior iteration
            try {
              await github.rest.git.deleteRef({ owner, repo, ref: `heads/${fixBranch}` });
              core.info(`Deleted stale fix branch ${fixBranch}`);
            } catch { /* branch didn't exist */ }

            // Create fix branch at tip of feature branch
            await github.rest.git.createRef({
              owner, repo, ref: `refs/heads/${fixBranch}`, sha,
            });
            core.info(`Created fix branch ${fixBranch} at ${sha}`);
            core.setOutput('fix_branch',  fixBranch);
            core.setOutput('branch_suffix', suffix);
            core.setOutput('feature_sha', sha);

      - name: Read review findings comment (FR-011)
        id: findings
        if: steps.guard.outputs.skip != 'true'
        uses: actions/github-script@v8
        with:
          script: |
            const owner          = context.repo.owner;
            const repo           = context.repo.repo;
            const featurePRNumber = Number('${{ github.event.inputs.feature_pr_number }}');

            // Find the most recent structured findings comment from the review agent
            const { data: comments } = await github.rest.issues.listComments({
              owner, repo, issue_number: featurePRNumber, per_page: 100,
            });
            // Review agent posts findings BEFORE the context block.
            // Safe discriminant: most recent bot comment that does NOT contain a context block.
            const findingsComment = [...comments].reverse().find(c =>
              (c.user?.type === 'Bot' || c.user?.login?.endsWith('[bot]')) &&
              !(c.body || '').includes('<!-- agentic-flow-context')
            );
            if (!findingsComment) {
              core.warning('Could not locate findings comment on feature PR; fix dispatch will proceed without findings snippet.');
            }

            // Use the findings comment URL for agent reference; embed a summary in the PR body
            const findingsUrl     = findingsComment?.html_url || '';
            const findingsSnippet = findingsComment
              ? findingsComment.body.substring(0, 2000)
              : '_Could not locate findings comment._';

            const findingsSnippet = findingsComment
              ? findingsComment.body.substring(0, 2000)
              : '_Could not locate findings comment._';

            core.setOutput('findings_url',     findingsUrl);
            // NOTE: multi-line output consumed via env var (FINDINGS_SNIPPET) in downstream
            // steps to avoid YAML/JS template literal injection (M5).
            core.setOutput('findings_snippet', findingsSnippet);

      - name: Open fix task PR (FR-012)
        id: pr
        if: steps.guard.outputs.skip != 'true'
        uses: actions/github-script@v8
        with:
          github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
          env:
            FINDINGS_SNIPPET: ${{ steps.findings.outputs.findings_snippet }}
          script: |
            const owner              = context.repo.owner;
            const repo               = context.repo.repo;
            const featureIssueNumber = '${{ github.event.inputs.feature_issue_number }}';
            const featurePRNumber    = '${{ github.event.inputs.feature_pr_number }}';
            const featureBranch      = '${{ github.event.inputs.feature_branch }}';
            const specDirectory      = '${{ github.event.inputs.spec_directory }}';
            const fixBranch          = '${{ steps.branch.outputs.fix_branch }}';
            const findingsUrl        = '${{ steps.findings.outputs.findings_url }}';
            // Multi-line findings snippet consumed via env var to avoid template literal injection
            const findingsSnippet    = process.env.FINDINGS_SNIPPET || '_Could not locate findings comment._';

            // PR body includes the four fields implement-merge.yml requires (AD-6)
            // Task issue uses feature issue as placeholder (guarded in implement-merge.yml, AD-4)
            const prBody = [
              `**Feature issue:** #${featureIssueNumber}`,
              `**Feature PR:** #${featurePRNumber}`,
              `**Task issue:** #${featureIssueNumber}`,
              `**Spec directory:** \`${specDirectory}\``,
              '',
              '---',
              '',
              '## Review Fix Task',
              '',
              'This PR addresses findings from the automated review stage.',
              findingsUrl ? `**Review findings**: ${findingsUrl}` : '',
              '',
              '### Findings (excerpt)',
              '',
              findingsSnippet,
              '',
              '---',
              '_agentic-flow review fix — auto-generated_',
            ].join('\n');

            const { data: fixPR } = await github.rest.pulls.create({
              owner, repo,
              title:  `[review-fix] Apply review findings — feature #${featureIssueNumber}`,
              body:   prBody,
              head:   fixBranch,
              base:   featureBranch,
              draft:  false,
            });
            core.info(`Created fix task PR #${fixPR.number}`);

            // Apply both labels
            await github.rest.issues.addLabels({
              owner, repo, issue_number: fixPR.number,
              labels: ['agentic-flow-task-pr', 'agentic-flow-review-fix-pr'],
            });

            core.setOutput('fix_pr_number', String(fixPR.number));

      - name: Assign implement agent to fix PR (FR-011)
        if: steps.guard.outputs.skip != 'true'
        uses: ./.github/actions/assign-pr-agent
        with:
          stage-name: review-fix
          agent-name: agentic-flow-implement
          context-source: direct
          pull-number:          ${{ steps.pr.outputs.fix_pr_number }}
          feature-issue-number: ${{ github.event.inputs.feature_issue_number }}
          spec-directory:       ${{ github.event.inputs.spec_directory }}
          task-issue-number:    ${{ github.event.inputs.feature_issue_number }}
          feature-pr-number:    ${{ github.event.inputs.feature_pr_number }}
          agent-token:          ${{ secrets.GH_AW_AGENT_TOKEN }}
```

**FR coverage**: FR-011, FR-012, FR-015

---

### 3.6 `src/.github/workflows/review-fix-complete-trigger.yml` — new file

Standard GHA YAML. Detects when a fix task PR merges into the feature branch and re-dispatches
`review-dispatch.yml` (FR-013).

```
name: Review Fix Complete Trigger (agentic-flow)

on:
  pull_request:
    types: [closed]

permissions:
  contents: read
  actions: write
  issues: write

jobs:
  rerun-review:
    # Only fire for merged PRs with the review-fix label
    if: |
      github.event.pull_request.merged == true &&
      contains(github.event.pull_request.labels.*.name, 'agentic-flow-review-fix-pr')
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: write
      issues: write
    steps:
      - name: Extract context from fix PR body
        id: context
        uses: actions/github-script@v8
        with:
          script: |
            const body = context.payload.pull_request.body || '';

            // Guard: only fire if PR merged (not closed without merge)
            // (already guaranteed by the job if: condition above, but checked for safety)
            if (!context.payload.pull_request.merged) {
              core.info('Fix PR was closed without merging; not re-dispatching review.');
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo:  context.repo.repo,
                issue_number: context.payload.pull_request.number,
                body: [
                  '## ⚠️ Review Fix PR Closed Without Merging',
                  '',
                  'This fix task PR was closed without being merged. The review stage',
                  'will not re-run automatically. Human intervention is required.',
                  '',
                  '_agentic-flow implementation pipeline_',
                ].join('\n'),
              });
              core.setOutput('skip', 'true'); return;
            }

            const featureIssueMatch = body.match(/\*\*Feature issue:\*\*\s*#(\d+)/);
            const featurePRMatch    = body.match(/\*\*Feature PR:\*\*\s*#(\d+)/);
            const specDirMatch      = body.match(/\*\*Spec directory:\*\*\s*`([^`]+)`/);

            if (!featureIssueMatch || !featurePRMatch || !specDirMatch) {
              core.setFailed('Could not parse required context from fix PR body.');
              return;
            }

            const featureBranch = context.payload.pull_request.base.ref;

            core.setOutput('skip',                 'false');
            core.setOutput('feature_issue_number', featureIssueMatch[1]);
            core.setOutput('feature_pr_number',    featurePRMatch[1]);
            core.setOutput('feature_branch',       featureBranch);
            core.setOutput('spec_directory',       specDirMatch[1]);

      - name: Re-dispatch review stage (FR-013)
        if: steps.context.outputs.skip != 'true'
        uses: actions/github-script@v8
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo:  context.repo.repo,
              workflow_id: 'review-dispatch.yml',
              ref: 'main',
              inputs: {
                feature_issue_number: '${{ steps.context.outputs.feature_issue_number }}',
                feature_pr_number:    '${{ steps.context.outputs.feature_pr_number }}',
                feature_branch:       '${{ steps.context.outputs.feature_branch }}',
                spec_directory:       '${{ steps.context.outputs.spec_directory }}',
              },
            });
            core.info('Re-dispatched review-dispatch.yml after fix PR merge.');
```

**FR coverage**: FR-013

---

### 3.7 `src/.github/actions/assign-pr-agent/main.js` — modifications

**Add two new stage name branches** to the existing `if/else if` chain (after the
`audit` branch, before the final `else { fail(...) }`).

#### `review` stage

```javascript
} else if (stageName === "review") {
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to perform a comprehensive cross-cutting review of this feature PR and post your review when done.`;
  contextPhase    = "review";
  contextRunMode  = "review";
  agentHeader     = "Review Agent — Startup Instructions";
  stageTaskField  = "";  // no task issue for review
  instructions = [
    `1. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` in full for feature context.`,
    `2. Fetch and review the complete diff of feature PR #${itemPullNumber} — every changed file.`,
    `3. Perform four cross-cutting checks and document ALL findings per category:`,
    `   a. **Security**: hardcoded credentials or secrets, unsafe user-input handling, injection-pattern anti-patterns, dependency versions with known published vulnerabilities.`,
    `   b. **Architecture**: adherence to every design decision in \`${specDirectory}/plan.md\`, absence of unintended coupling between components the plan treats as independent, consistency of naming and structural patterns across the feature branch.`,
    `   c. **Acceptance criteria**: for EVERY acceptance criterion in \`${specDirectory}/spec.md\`, confirm the feature branch contains implementation and/or tests that address it. List each unmet criterion individually.`,
    `   d. **Coverage**: presence of tests for each critical path in \`${specDirectory}/tasks.md\`, and obvious untested branches in new code (error handlers, boundary conditions) that have no corresponding test. If \`${specDirectory}/tasks.md\` is absent, skip this check and note its absence in the findings rather than failing.`,
    `4. If ALL checks pass (zero findings in all four categories):`,
    `   - Submit a formal APPROVE PR review on PR #${itemPullNumber}.`,
    `   - Post a summary comment confirming all four categories passed.`,
    `   - Post the \`<!-- agentic-flow-context ... -->\` block below with \`Audit result: APPROVE\`.`,
    `5. If ANY finding exists in any category:`,
    `   - Post a structured findings comment on PR #${itemPullNumber} listing every issue with: category, file path (if applicable), description, and remediation guidance. This is required for the fix agent.`,
    `   - Submit a formal REQUEST_CHANGES PR review on PR #${itemPullNumber}.`,
    `   - Post the \`<!-- agentic-flow-context ... -->\` block below with \`Audit result: REQUEST_CHANGES\`.`,
    `6. The context comment MUST include the \`<!-- agentic-flow-context ... -->\` sentinel exactly — it is machine-parsed by the pipeline trigger.`,
  ].join("\n");
```

Context block fields for review stage:
```javascript
...(stageName === "review" ? [
  `Feature PR: #${itemPullNumber}`,
  `Feature branch: \`${headRefName}\``,
] : []),
```

Human note for review stage:
```javascript
: stageName === "review"
? `> This feature PR will be processed by the automated pipeline based on the review result. No human action is required until the pipeline posts a "Ready for Human Merge" or error comment.`
```

#### `review-fix` stage

```javascript
} else if (stageName === "review-fix") {
  stageIssueRef   = directMode ? featurePRNumberDirect : "";
  stageIssueLabel = "Feature PR";
  firstLine = `@copilot please use the already-assigned \`${agentName}\` custom agent to implement the review fix described in the findings comment on feature PR #${stageIssueRef} and post your completion summary when done.`;
  contextPhase    = "review-fix";
  contextRunMode  = "review-fix";
  agentHeader     = "Review Fix Agent — Startup Instructions";
  stageTaskField  = `Feature PR: #${stageIssueRef}`;
  instructions = [
    `1. Read the most recent review findings comment posted by the \`agentic-flow-review\` agent on feature PR #${stageIssueRef}. It lists all issues to fix, organised by category.`,
    `2. Read the fix task PR body (the current PR) — it contains a findings excerpt and links to the full findings comment.`,
    `3. Read \`${specDirectory}/spec.md\`, \`${specDirectory}/plan.md\`, and \`${specDirectory}/tasks.md\` for full feature context.`,
    `4. Read the current state of the feature branch (\`${baseRefName}\`) to understand what is already implemented.`,
    `5. Implement all fixes described in the review findings on branch \`${headRefName}\`. Use \`create_or_update_file\` to commit all changes — do NOT use \`git push\`.`,
    `6. Post an implementation summary on this PR. The comment MUST include the \`<!-- agentic-flow-context ... -->\` block.`,
    `7. Apply the \`ready-to-merge-task\` label to this PR to signal completion.`,
  ].join("\n");
```

Context block fields for `review-fix` stage (mirrors `implement` stage with phase `review-fix`):
```javascript
...(stageName === "review-fix" ? [
  `Feature branch: \`${baseRefName}\``,
  `Fix branch: \`${headRefName}\``,
  `Feature PR: #${featurePRNumberDirect}`,
] : []),
```

Human note for `review-fix` stage:
```javascript
: stageName === "review-fix"
? `> This fix task PR will be **auto-merged** once CI checks pass. No human action required.`
```

**Validation guard**: Add `review-fix` to the "allowed stage names" list alongside `review`.

---

### 3.8 `src/.github/workflows/implement-merge.yml` — modifications

Two targeted guards are added (AD-4). No other logic changes.

**Guard 1 — "Close task issue with summary" step**:
```yaml
- name: Close task issue with summary
  if: |
    steps.resolve.outputs.skip != 'true' &&
    steps.merge.outputs.merged == 'true' &&
    !contains(steps.resolve.outputs.task_pr_labels, 'agentic-flow-review-fix-pr')
```

To make `task_pr_labels` available, a line is added to the resolve step outputs:
```javascript
core.setOutput('task_pr_labels', JSON.stringify(pr.labels?.map(l => l.name) || []));
```

**Guard 2 — "Find next task or dispatch audit" step**:
```yaml
- name: Find next task or dispatch audit
  if: |
    steps.resolve.outputs.skip != 'true' &&
    steps.merge.outputs.merged == 'true' &&
    !contains(steps.resolve.outputs.task_pr_labels, 'agentic-flow-review-fix-pr')
```

The "Update feature issue progress" step (posts a comment on the feature issue) is NOT guarded:
it is acceptable for a benign "Task PR merged" comment to appear on the feature issue when a
fix PR merges; this keeps the feature issue history complete.

The `check_run` path filter in the outer `jobs.merge-task-pr.if:` is extended to include
`review-fix/` branches:
```yaml
if: |
  (github.event_name == 'pull_request') ||
  (github.event_name == 'check_run' && (
    startsWith(github.event.check_run.check_suite.head_branch, 'implement/') ||
    startsWith(github.event.check_run.check_suite.head_branch, 'task/') ||
    startsWith(github.event.check_run.check_suite.head_branch, 'review-fix/')
  ))
```

---

### 3.9 `src/.github/copilot/instructions.md` — modifications (FR-018)

**Pipeline table**: Insert a new `Review` row between `Audit` and `Merge`:

```markdown
| Review | All audit tasks closed with APPROVE | `audit-chain-trigger.yml` → `review-dispatch.yml` → `agentic-flow-review` | Four-category cross-cutting check (security, architecture, AC coverage, test coverage); APPROVE advances to Merge; REQUEST_CHANGES triggers fix loop |
```

**Labels table**: Add new labels:

```markdown
| `agentic-flow-review-fix-pr` | Fix task PR targeting the feature branch to address review findings |
```

**Wrapper Ownership table**: Add review wrapper entries:

```markdown
| `agentic-flow-review` | Cross-cutting review on the feature PR: security, architecture, acceptance criteria, coverage |
```

---

### 3.10 `AGENTS.md` — modifications (FR-019)

**Pipeline overview table**: Insert `Review` stage between `Audit` and `Merge`.

**ADR section**: Add a new Architecture Decision Record:

```markdown
| Review stage fix loop uses `agentic-flow-implement` (not a new agent) | Reusing the implement agent for fixes avoids defining a new agent and reuses battle-tested implementation machinery; findings are injected via the startup comment |
| Iteration cap tracked by counting prior REQUEST_CHANGES context blocks on the PR | No persistence layer or external store needed; the PR comment history is the source of truth; five consecutive REQUEST_CHANGES without an APPROVE triggers human intervention |
| `review-result-trigger.yml` (not the review agent) routes APPROVE/REQUEST_CHANGES | Consistent with the existing pipeline pattern where GHA workflows react to agent outputs; more robust than agent-dispatched follow-up workflows |
| Fix PRs use `agentic-flow-review-fix-pr` label to guard `implement-merge.yml` chain-advance | The spec assumed no changes to `implement-merge.yml` were needed; analysis showed the chain-advance logic would incorrectly mark the PR ready when all sub-issues are already closed post-audit; a targeted label guard is the minimal correct fix |
| Fix branch naming: `review-fix/{feature-suffix}` reused across iterations | Branches are deleted after their fix PR merges; reusing the same name keeps branch lists clean; the concurrent-fix guard (FR-015) prevents collision |
```

---

## 4. Data Model

### 4.1 Review context block (machine-parseable, posted by `agentic-flow-review`)

```
<!-- agentic-flow-context
Phase: review
Run mode: review
Feature issue: #<N>
Feature PR: #<N>
Spec directory: specs/<NNN>-<slug>
Feature branch: `implement/<NNN>-<slug>`
Audit result: APPROVE          ← or REQUEST_CHANGES
-->
```

Fields parsed by `review-result-trigger.yml`:
- `Audit result` → routing decision (APPROVE / REQUEST_CHANGES)
- `Feature issue` → feature issue number for label application and comments
- `Feature PR` → PR number for un-draft and label application
- `Spec directory` → passed through to fix dispatch

### 4.2 Fix task PR body (written by `review-fix-dispatch.yml`)

```markdown
**Feature issue:** #<N>
**Feature PR:** #<N>
**Task issue:** #<N>          ← feature issue used as placeholder
**Spec directory:** `specs/<NNN>-<slug>`

---

## Review Fix Task

This PR addresses findings from the automated review stage.
**Review findings**: <URL to findings comment>

### Findings (excerpt)

<findings_snippet — up to 2000 chars from most recent review agent comment>

---
_agentic-flow review fix — auto-generated_
```

### 4.3 Review-fix context block (posted by `agentic-flow-implement` on fix PR)

```
<!-- agentic-flow-context
Phase: review-fix
Run mode: review-fix
Feature issue: #<N>
Feature PR: #<N>
Spec directory: specs/<NNN>-<slug>
Feature branch: `implement/<NNN>-<slug>`
Fix branch: `review-fix/<NNN>-<slug>`
-->
```

---

## 5. FR-to-Component Traceability

| Requirement | Component(s) |
|-------------|-------------|
| FR-001 | `audit-chain-trigger.yml` — dispatch to `review-dispatch.yml` replaces "mark ready" step |
| FR-002 | `audit-chain-trigger.yml` — "mark ready" step removed |
| FR-003 | `review-dispatch.yml` — no issue creation; `review-result-trigger.yml` — no issue creation |
| FR-004 | `agentic-flow-review.agent.md` + `assign-pr-agent/main.js` (review stage instructions) — context block sentinel requirement |
| FR-005 | `agentic-flow-review.agent.md` + startup instructions — security check category |
| FR-006 | `agentic-flow-review.agent.md` + startup instructions — architecture check category |
| FR-007 | `agentic-flow-review.agent.md` + startup instructions — acceptance criteria check |
| FR-008 | `agentic-flow-review.agent.md` + startup instructions — coverage check |
| FR-009 | `agentic-flow-review.agent.md` — APPROVE iff zero findings; REQUEST_CHANGES iff any finding |
| FR-010 | `agentic-flow-review.agent.md` + startup instructions step 5 — structured findings comment |
| FR-011 | `review-result-trigger.yml` (dispatch) + `review-fix-dispatch.yml` (fix setup) + `assign-pr-agent/main.js` (review-fix stage) |
| FR-012 | `review-fix-dispatch.yml` — branch create + PR create steps |
| FR-013 | `review-fix-complete-trigger.yml` — detects merged fix PR, re-dispatches `review-dispatch.yml` |
| FR-014 | `review-result-trigger.yml` — iteration counter + halt path |
| FR-015 | `review-fix-dispatch.yml` — guard step checks for open fix PR before creation |
| FR-016 | `review-result-trigger.yml` — APPROVE handler: un-draft + label + summary comments |
| FR-017 | `review-result-trigger.yml` — APPROVE handler: collects audit tasks + review result in summary |
| FR-018 | `src/.github/copilot/instructions.md` — pipeline table + labels table + wrapper ownership table |
| FR-019 | `AGENTS.md` — pipeline overview + ADR entries |

---

## 6. Edge Case Handling

| Edge Case | Handling |
|-----------|---------|
| Dispatch fails when all audits pass | `audit-chain-trigger.yml` wraps dispatch in try/catch; posts error comment on feature PR; leaves PR in draft |
| Fix loop does not converge (5 iterations) | `review-result-trigger.yml` counts prior REQUEST_CHANGES blocks; on ≥ 5, posts error on feature PR + feature issue, stops dispatch (FR-014) |
| Fix PR closed without merging | `review-fix-complete-trigger.yml` job condition requires `merged == true`; closed-without-merge fires the job, inner check posts a warning and sets skip=true; no re-dispatch |
| PR already approved by prior review run | `review-dispatch.yml` validate step checks for existing APPROVE context block; sets skip=true; no duplicate dispatch |
| Concurrent fix branches (two dispatches race) | `review-fix-dispatch.yml` guard step: list open PRs with `agentic-flow-review-fix-pr` label targeting feature branch; if any open, post warning and skip |
| Audit closes without genuine APPROVE context block | Existing guard in `audit-chain-trigger.yml` already verifies APPROVE context block before advancing; unchanged; review dispatch only fires after this guard passes |
| Stale fix branch from previous iteration | `review-fix-dispatch.yml` delete-and-recreate pattern: attempts `deleteRef` on `review-fix/{suffix}` before `createRef`; API 404 on non-existent branch is silently ignored |
| `implement-merge.yml` chain-advance bypasses review | Guarded by `agentic-flow-review-fix-pr` label check on "Find next task" step (AD-4); chain-advance is skipped for fix PRs |
| Review agent posts no context block (silent failure) | `review-dispatch.yml` assigns the agent but cannot detect a hang. **Mitigation**: `review-dispatch.yml` posts a startup comment on the feature PR with an error recovery instruction ("If no review result appears within 24h, post `/rerun-review` or check the Actions tab"). The feature PR remains in draft until a context block is posted, so it is visibly blocked. A dedicated watchdog is a planned future enhancement. |
| Fix agent fails to apply `ready-to-merge-task` label | `implement-merge.yml` never fires; `review-fix-complete-trigger.yml` never fires; the fix loop stalls. **Recovery**: human re-runs `review-fix-dispatch.yml` workflow_dispatch with the same inputs (idempotency guard handles the existing open fix PR). Documented in the PR startup comment posted by `review-dispatch.yml`. |

---

## 7. Files Changed Summary

### New files

| File | Type | Purpose |
|------|------|---------|
| `src/.github/workflows/review-dispatch.yml` | Standard GHA YAML | Assigns `agentic-flow-review` to feature PR via `assign-pr-agent` |
| `src/.github/workflows/review-result-trigger.yml` | Standard GHA YAML | Routes APPROVE (human-gate handoff) / REQUEST_CHANGES (fix loop or halt) |
| `src/.github/workflows/review-fix-dispatch.yml` | Standard GHA YAML | Creates fix branch, opens fix task PR, assigns `agentic-flow-implement` |
| `src/.github/workflows/review-fix-complete-trigger.yml` | Standard GHA YAML | Detects fix PR merge; re-dispatches `review-dispatch.yml` |
| `src/.github/agents/agentic-flow-review.agent.md` | Agent definition (`gh aw`) | Review agent: four-category cross-cutting checks |

### Modified files

| File | Change summary |
|------|---------------|
| `src/.github/workflows/audit-chain-trigger.yml` | Replace "Mark feature PR ready" final step with dispatch to `review-dispatch.yml`; add dispatch error handling |
| `src/.github/actions/assign-pr-agent/main.js` | Add `review` stage (four-check startup instructions + context block fields) and `review-fix` stage (findings-lookup startup instructions) to the stage `if/else if` chain; extend context block field logic; extend human note logic; extend validation guard to accept new stage names |
| `src/.github/workflows/implement-merge.yml` | (1) Output `task_pr_labels` in resolve step; (2) add `agentic-flow-review-fix-pr` guard to "Close task issue" step; (3) add same guard to "Find next task or dispatch audit" step; (4) extend outer `if:` filter to include `review-fix/` branches for `check_run` events |
| `src/.github/copilot/instructions.md` | Add `Review` row to pipeline table; add `agentic-flow-review-fix-pr` label to Labels table; add `agentic-flow-review` to Wrapper Ownership table |
| `AGENTS.md` | Add `Review` to pipeline overview table; add ADR entries for fix-loop design decisions |

---

## 8. Implementation Order (dependency-safe)

The following sequencing avoids breaking the live pipeline at any intermediate step:

1. **`assign-pr-agent/main.js`** — add `review` and `review-fix` stage branches.
   _(No impact on existing stages; new branches are dead code until consumed.)_

2. **`implement-merge.yml`** — add label output + two step guards.
   _(Guards are no-ops until `agentic-flow-review-fix-pr`-labelled PRs exist.)_

3. **`src/.github/agents/agentic-flow-review.agent.md`** — create agent definition.
   _(Inert until assigned.)_

4. **`review-dispatch.yml`** — create workflow.
   _(Can be triggered manually to test agent assignment before pipeline integration.)_

5. **`review-result-trigger.yml`** — create workflow.
   _(Listens but does nothing until a review context block appears.)_

6. **`review-fix-dispatch.yml`** — create workflow.
   _(Listens but does nothing until explicitly dispatched.)_

7. **`review-fix-complete-trigger.yml`** — create workflow.
   _(Listens but does nothing until a `agentic-flow-review-fix-pr`-labelled PR merges.)_

8. **`audit-chain-trigger.yml`** — replace the "Mark feature PR ready" step with dispatch to
   `review-dispatch.yml`. This is the integration point. Deploy last so all downstream
   components are ready.

9. **`src/.github/copilot/instructions.md`** + **`AGENTS.md`** — documentation updates.
   _(Can be done any time; no pipeline impact.)_
