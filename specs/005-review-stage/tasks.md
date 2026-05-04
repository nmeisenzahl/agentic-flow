---
description: "Task list for 005-review-stage — automated review stage between audit completion and human merge"
---

# Tasks: Automated Review Stage

**Feature**: `005-review-stage`  
**Input**: `specs/005-review-stage/plan.md` + `specs/005-review-stage/spec.md`  
**Validation**: speckit.analyze (consistency) → `claude-opus-4.6` + `gpt-5.4` technical review (Principle III) — both layers MUST PASS before human gate.

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel with other [P]-marked tasks in the same phase (different files, no shared dependencies on incomplete work)
- **[US1–US4]**: User story this task belongs to (maps to priorities P1–P4 in spec.md)
- Foundational and Polish phases carry no story label

---

## Phase 1: Setup

**Purpose**: No new project scaffolding needed — the `src/.github/` tree already exists. All 10 components are modifications or additions within that tree. Proceed directly to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Two targeted changes that must land before any review-stage code can safely activate. Both are safe no-ops on the live pipeline until review-stage workflows exist; deploying them first avoids a window where a fix PR could accidentally advance the audit chain.

**⚠️ CRITICAL**: T001 must be committed before any workflow that calls `assign-pr-agent` with `stage-name: review` or `stage-name: review-fix`. T002 must be committed before any `agentic-flow-review-fix-pr`-labelled PR can merge.

- [x] T001 Add `review` and `review-fix` stage branches to `src/.github/actions/assign-pr-agent/main.js` — insert both new `} else if (stageName === "review") {` and `} else if (stageName === "review-fix") {` branches into the existing stage `if/else if` chain (after the `audit` branch, before the final `else { fail(...) }` validation guard); for the `review` branch set `contextPhase = "review"`, `contextRunMode = "review"`, `agentHeader = "Review Agent — Startup Instructions"`, `stageTaskField = ""` (no task issue), and populate `instructions` with the six-step review protocol (read spec/plan/tasks, fetch PR diff, run four-category checks, APPROVE path including context block, REQUEST_CHANGES path including findings comment + context block, context-block sentinel note); for the `review-fix` branch set `contextPhase = "review-fix"`, `contextRunMode = "review-fix"`, `agentHeader = "Review Fix Agent — Startup Instructions"`, `stageIssueLabel = "Feature PR"`, `stageTaskField = \`Feature PR: #\${stageIssueRef}\``, and populate `instructions` with the seven-step fix protocol (read findings comment on feature PR, read fix PR body, read spec/plan/tasks, read feature branch state, implement fixes on fix branch using `create_or_update_file`, post summary with context block, apply `ready-to-merge-task` label); extend the context block field logic: for `review` emit `Feature PR: #\${itemPullNumber}` and `Feature branch: \`\${headRefName}\``; for `review-fix` emit `Feature branch: \`\${baseRefName}\``, `Fix branch: \`\${headRefName}\``, and `Feature PR: #\${featurePRNumberDirect}\``; extend the human note logic: for `review` emit the "No human action required until Ready for Human Merge" note; for `review-fix` emit the "This fix task PR will be auto-merged" note; extend the validation guard's allowed-stage-names list to include `"review"` and `"review-fix"`

- [x] T002 Modify `src/.github/workflows/implement-merge.yml` to guard against review-fix PRs advancing the audit chain — three targeted changes: (1) in the `resolve` step's `actions/github-script` script block, add `core.setOutput('task_pr_labels', JSON.stringify(pr.labels?.map(l => l.name) || []))` so the label list is available to downstream steps; (2) add `&& !contains(steps.resolve.outputs.task_pr_labels, 'agentic-flow-review-fix-pr')` to the `if:` condition of the "Close task issue with summary" step — this prevents the feature issue used as a placeholder task-issue field from being incorrectly closed when a fix PR merges; (3) add the same `!contains(steps.resolve.outputs.task_pr_labels, 'agentic-flow-review-fix-pr')` guard to the `if:` condition of the "Find next task or dispatch audit" step — this prevents chain-advance logic from firing (all sub-issues are already closed post-audit, so the no-open-tasks branch would incorrectly mark the feature PR ready for merge); do NOT guard the "Update feature issue progress" step or the merge step itself; (4) extend the outer `jobs.merge-task-pr.if:` `check_run` filter to add `|| startsWith(github.event.check_run.check_suite.head_branch, 'review-fix/')` alongside the existing `implement/` and `task/` prefixes so that CI check events on fix branches trigger this workflow

**Checkpoint**: Foundational guards deployed — no fix PR can incorrectly advance the audit chain; new stage names are accepted by `assign-pr-agent`

---

## Phase 3: User Story 1 — Review Fires Automatically After All Audits Pass (Priority: P1) 🎯 MVP

**Goal**: After the last open audit task issue closes with a verified APPROVE context block, the pipeline dispatches the review agent to the feature PR automatically — no human action, no manual trigger. The feature PR remains in draft during the review.

**Independent Test**: Close the last open audit task issue with APPROVE on a feature that has a complete feature PR. Verify that the feature PR is NOT immediately un-drafted and that the review agent is dispatched to it within the same automated run.

**Dependency**: T001 must be complete before T003 is deployed to `main`.

### Implementation for User Story 1

- [x] T003 [P] [US1] Create `src/.github/agents/agentic-flow-review.agent.md` — agent definition using the `gh aw` agent format; declare `tools: [read, search, execute]` plus GitHub MCP tools (PR review submission, comment creation); in the agent body state that the agent: (a) reads the spec directory files (`spec.md`, `plan.md`, `tasks.md`) for full feature context, (b) fetches the complete diff of the feature PR via GitHub MCP, (c) runs four cross-cutting check categories (security: hardcoded credentials/secrets, unsafe user-input handling, injection-pattern anti-patterns, vulnerable dependency versions; architecture: adherence to all decisions in `plan.md`, absence of unintended coupling, naming/structural consistency; acceptance criteria: confirm every criterion in `spec.md` has a corresponding implementation or test — list each unmet criterion individually; coverage: test presence for critical paths in `tasks.md` and obvious untested branches in new code, with a note to skip this check and document its absence if `tasks.md` is absent), (d) on zero findings submits a formal APPROVE PR review + summary comment + context block with `Audit result: APPROVE`, (e) on any finding posts a structured findings comment organised by category (each finding includes: category, file path, description, remediation guidance), submits a formal REQUEST_CHANGES PR review, and posts context block with `Audit result: REQUEST_CHANGES`; the agent MUST include the exact `<!-- agentic-flow-context Phase: review ... Audit result: APPROVE|REQUEST_CHANGES -->` sentinel in a PR comment (see §4.1 of plan.md for the exact block format)

- [x] T004 [P] [US1] Create `src/.github/workflows/review-dispatch.yml` — standard GHA YAML; trigger: `workflow_dispatch` with four required inputs (`feature_issue_number`, `feature_pr_number`, `feature_branch`, `spec_directory`); concurrency group: `review-dispatch-${{ github.event.inputs.feature_pr_number }}` with `cancel-in-progress: false`; single job `dispatch` on `ubuntu-latest` with `environment: copilot` and permissions `[contents: read, pull-requests: write, issues: write]`; Step 1 — `actions/checkout@v4`; Step 2 — `id: validate` `actions/github-script@v8`: call `github.rest.pulls.get` to verify feature PR is open (set `output.skip = 'true'` and return if not), then scan `github.rest.issues.listComments` (`per_page: 100`) for any bot comment containing `<!-- agentic-flow-context`, `Phase: review`, and `Audit result: APPROVE` — if found set skip=true with warning "Feature PR already has a review APPROVE; skipping re-dispatch", otherwise set skip=false; Step 3 — `if: steps.validate.outputs.skip != 'true'` call `./.github/actions/assign-pr-agent` with `stage-name: review`, `agent-name: agentic-flow-review`, `context-source: direct`, and pass through all four workflow inputs plus `agent-token: ${{ secrets.GH_AW_AGENT_TOKEN }}`

- [x] T005 [US1] Modify `src/.github/workflows/audit-chain-trigger.yml` — replace the "Mark feature PR ready for human merge" step (the final `if: ... open_audit_count == '0'` step that currently un-drafts the PR, applies `implementation-complete`, and posts "All Audits Complete" comments) with a "Dispatch review stage" step that calls `github.rest.actions.createWorkflowDispatch` targeting `review-dispatch.yml` on `ref: 'main'` with inputs `feature_issue_number`, `feature_pr_number`, `feature_branch`, and `spec_directory` drawn from the existing `steps.parse` and `steps.context` outputs; the step `if:` condition must be `steps.parse.outputs.skip != 'true' && steps.context.outputs.skip_chain != 'true' && steps.context.outputs.open_audit_count == '0'`; wrap the dispatch call in a `try/catch` block — on error post an error comment on the feature PR (using the existing error-comment pattern from the audit chain) and call `core.setFailed(...)` so the job fails visibly rather than silently falling through; the feature PR MUST remain in draft after this step; add `core.info('Dispatched review-dispatch.yml for feature PR #' + featurePRNumber)` on success; all prior steps in the workflow are unchanged — this is a surgical one-step replacement at the end of the job

**Checkpoint**: US1 fully wired — all audit tasks closing with APPROVE dispatches the review agent instead of marking the PR ready; feature PR stays in draft (SC-001 met)

---

## Phase 4: User Story 2 — Review Performs Four-Category Cross-Cutting Check (Priority: P2)

**Goal**: The review agent (created as T003) examines the complete feature branch and applies all four check categories, producing a clear pass/fail with specific findings. This phase has no additional file changes — US2 is entirely satisfied by the agent definition content in T003.

**Independent Test**: Dispatch the review agent to a feature PR containing a known security issue, an architecture inconsistency, an unmet acceptance criterion, and an untested code path. Verify that the agent's PR review cites a finding in each of the four categories before returning REQUEST_CHANGES.

*No additional implementation tasks — US2 acceptance scenarios are covered by T003 (agent definition). The four-category check logic, findings comment format, and APPROVE/REQUEST_CHANGES routing are fully specified in the `agentic-flow-review` agent's instructions.*

---

## Phase 5: User Story 3 — Issues Found Trigger an Automated Fix Loop (Priority: P3)

**Goal**: On REQUEST_CHANGES, the pipeline automatically creates a fix branch, opens a fix task PR with review findings as context, assigns the implement agent, auto-merges on completion, and re-runs the review — all without human action. A 5-iteration cap prevents infinite looping.

**Independent Test**: Dispatch the review agent to a feature PR with a known issue. Verify: (1) a fix branch is created, (2) the implement agent is assigned with review findings in context, (3) after `ready-to-merge-task` label is applied the fix PR auto-merges, and (4) the review is re-dispatched automatically.

**Dependency**: T001 and T002 must be complete before T008 is tested end-to-end.

### Implementation for User Story 3

- [x] T006 [US3] [US4] Create `src/.github/workflows/review-result-trigger.yml` — standard GHA YAML; trigger: `issue_comment: [created]`; concurrency: `review-result-trigger-${{ github.event.issue.number }}` with `cancel-in-progress: false`; top-level permissions: `contents: read, issues: write, pull-requests: write, actions: write`; job `route-review-result` with job-level `if:` filter — **must use `contains(..., 'Phase: review') && !contains(..., 'Phase: review-fix')`** to avoid matching `review-fix` context blocks (critical: a plain `contains('Phase: review')` substring match would fire on `Phase: review-fix` lines); the `if:` must also require bot author (`github.event.comment.user.type == 'Bot' || contains(github.event.comment.user.login, '[bot]')`) and `contains(github.event.comment.body, '<!-- agentic-flow-context')`; Step 1 — `id: parse` `actions/github-script`: extract context block with regex `/<!-- agentic-flow-context([\s\S]*?)-->/`, parse `Audit result`, `Feature issue`, `Feature PR`, `Spec directory` fields; call `github.rest.issues.get` on `featurePRNum` and verify `issue.pull_request` exists; set outputs `skip`, `audit_result` (uppercased), `feature_issue_number`, `feature_pr_number`, `spec_directory`; Step 2 — `id: context` `if: skip != 'true'`: scan feature issue comments for `<!-- agentic-flow-impl-context:[base64url] -->` marker, decode JSON, extract `featureBranch`; fall back to `implement/${specDir.replace(/^specs\//, '')}` if not found; set output `feature_branch`; Step 3 — "Handle APPROVE — human-gate handoff" `if: skip != 'true' && audit_result == 'APPROVE'` with `github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}`: (a) fetch sub-issues to build closed audit task summary list, (b) un-draft the feature PR via `github.rest.pulls.update({draft: false})` — wrap in try/catch with warning on failure, (c) apply `implementation-complete` label to feature issue — wrap in try/catch, (d) post "🎉 All Audits & Review Complete — Ready for Human Merge" summary comment on feature issue listing all closed audit tasks and confirming `✅ Review stage: APPROVE`, (e) post same summary on feature PR; Step 4 — "Handle REQUEST_CHANGES — check cap and dispatch fix" `if: skip != 'true' && audit_result == 'REQUEST_CHANGES'` with default GITHUB_TOKEN: list PR comments (`per_page: 100`), count bot comments containing `Phase: review` AND `Audit result: REQUEST_CHANGES` (including the current one — the current comment is already in the list); if `iterationCount >= 5` (MAX_ITERATIONS) post a "❌ Review Fix Loop Halted — Maximum Iterations Reached" error comment on both feature PR and feature issue (naming the count, requesting human intervention) and return without dispatching; otherwise call `github.rest.actions.createWorkflowDispatch` for `review-fix-dispatch.yml` on `ref: 'main'` with inputs `feature_issue_number`, `feature_pr_number`, `feature_branch`, `spec_directory`

- [x] T007 [P] [US3] Create `src/.github/workflows/review-fix-dispatch.yml` — standard GHA YAML; trigger: `workflow_dispatch` with four required inputs (`feature_issue_number`, `feature_pr_number`, `feature_branch`, `spec_directory`); concurrency: `review-fix-dispatch-${{ github.event.inputs.feature_pr_number }}` with `cancel-in-progress: false`; job `dispatch-fix` on `ubuntu-latest` with `environment: copilot` and permissions `contents: write, pull-requests: write, issues: write`; Step 1 — `actions/checkout@v4` with `fetch-depth: 0`; Step 2 — `id: guard` "Guard — check for existing open fix PR": call `github.rest.pulls.list({state: 'open', base: featureBranch, per_page: 50})`, find any PR with `agentic-flow-review-fix-pr` label; if found post a "⚠️ Review Fix — Concurrent Branch Detected" warning comment on the feature PR and set `output.skip = 'true'`; Step 3 — `id: branch` `if: guard.skip != 'true'` "Create fix branch": extract suffix from feature branch (`featureBranch.replace(/^implement\//, '')`), derive `fixBranch = \`review-fix/\${suffix}\``; call `github.rest.git.getRef({ref: \`heads/\${featureBranch}\`})` for SHA; attempt `github.rest.git.deleteRef` on the fix branch (silently ignore 404 — stale branch cleanup, AD-5); call `github.rest.git.createRef` at feature branch SHA; set outputs `fix_branch`, `branch_suffix`, `feature_sha`; Step 4 — `id: findings` `if: guard.skip != 'true'` "Read review findings comment": list PR comments (`per_page: 100`); find the most recent bot comment using **`!(c.body || '').includes('<!-- agentic-flow-context')`** as the sole discriminant — this is intentional: the review agent posts findings BEFORE the context block, so the most recent bot comment without a context-block sentinel is the findings comment; set `findings_url` (comment `html_url`) and `findings_snippet` (first 2000 chars of body, or fallback string); **IMPORTANT**: use `core.setOutput('findings_snippet', findingsSnippet)` and do NOT inline this value as a template literal in downstream steps — consume via `env: FINDINGS_SNIPPET: ${{ steps.findings.outputs.findings_snippet }}`; Step 5 — `id: pr` `if: guard.skip != 'true'` "Open fix task PR" with `github-token: ${{ secrets.GH_AW_AGENT_TOKEN }}` and `env: FINDINGS_SNIPPET: ${{ steps.findings.outputs.findings_snippet }}`: read `findingsSnippet = process.env.FINDINGS_SNIPPET`; construct PR body with all four fields `implement-merge.yml` requires (`**Feature issue:**`, `**Feature PR:**`, `**Task issue:** #featureIssueNumber` as placeholder, `**Spec directory:**`) plus a "## Review Fix Task" section embedding `findingsUrl` and `findingsSnippet`; call `github.rest.pulls.create` with `head: fixBranch`, `base: featureBranch`, `draft: false`; call `github.rest.issues.addLabels` to apply **both** `agentic-flow-task-pr` and `agentic-flow-review-fix-pr` labels; set output `fix_pr_number`; Step 6 — `if: guard.skip != 'true'` call `./.github/actions/assign-pr-agent` with `stage-name: review-fix`, `agent-name: agentic-flow-implement`, `context-source: direct`, `pull-number: ${{ steps.pr.outputs.fix_pr_number }}`, and pass through `feature_issue_number`, `spec_directory`, `feature_pr_number`; set `task-issue-number` to `feature_issue_number` (AD-6 placeholder); `agent-token: ${{ secrets.GH_AW_AGENT_TOKEN }}`

- [x] T008 [P] [US3] Create `src/.github/workflows/review-fix-complete-trigger.yml` — standard GHA YAML; trigger: `pull_request: types: [closed]`; top-level permissions: `contents: read, actions: write, issues: write`; job `rerun-review` with job-level `if:` requiring `github.event.pull_request.merged == true && contains(github.event.pull_request.labels.*.name, 'agentic-flow-review-fix-pr')`; job-level permissions mirror top-level; Step 1 — `id: context` `actions/github-script`: read `context.payload.pull_request.body`; add an inner safety check `if (!context.payload.pull_request.merged)` (belt-and-suspenders beyond the job `if:`) — post a "⚠️ Review Fix PR Closed Without Merging" comment on the fix PR and set `skip = 'true'`; parse `**Feature issue:**`, `**Feature PR:**`, `**Spec directory:**` from the PR body with regex; extract `featureBranch = context.payload.pull_request.base.ref`; call `core.setFailed` if any field is missing; set outputs `skip`, `feature_issue_number`, `feature_pr_number`, `feature_branch`, `spec_directory`; Step 2 — `if: steps.context.outputs.skip != 'true'` "Re-dispatch review stage": call `github.rest.actions.createWorkflowDispatch` for `review-dispatch.yml` on `ref: 'main'` with all four context outputs as inputs; log "Re-dispatched review-dispatch.yml after fix PR merge"

**Checkpoint**: Full fix loop wired — REQUEST_CHANGES → fix branch → implement agent → auto-merge → re-review, with 5-iteration halt; APPROVE → human-gate handoff (SC-003, SC-004, SC-005, SC-006 met)

---

## Phase 6: User Story 4 — Review Pass Hands Off to the Human Gate (Priority: P4)

**Goal**: When the review agent posts APPROVE, the pipeline transitions to the human-merge gate with identical state to what `audit-chain-trigger.yml` previously produced.

**Independent Test**: Run a review that passes on the first attempt and verify the feature PR state (non-draft), label (`implementation-complete`), and comment content match exactly what the current pipeline produced post-audit.

*No additional implementation tasks — US4 acceptance scenarios are fully covered by the APPROVE handler in T006 (`review-result-trigger.yml`). The un-draft, `implementation-complete` label application, and dual-comment (feature issue + feature PR) are all implemented there.*

---

## Phase 7: Polish & Documentation

**Purpose**: Update developer-facing documentation to reflect the new Review stage.

- [x] T009 [P] Update `src/.github/copilot/instructions.md` — three targeted additions: (1) in the pipeline stages table, insert a new `Review` row between the existing `Audit` row and the `Merge` row with columns: Stage=`Review`, Trigger=`All audit tasks closed with APPROVE`, Workflow/Agent=`audit-chain-trigger.yml → review-dispatch.yml → agentic-flow-review`, Description=`Four-category cross-cutting check (security, architecture, acceptance-criteria coverage, test coverage); APPROVE advances to Merge; REQUEST_CHANGES triggers automated fix loop (max 5 iterations)`; (2) in the Labels table, add a row for `agentic-flow-review-fix-pr` with description `Fix task PR targeting the feature branch to address review findings — applied by review-fix-dispatch.yml; guards implement-merge.yml chain-advance logic`; (3) in the Wrapper Ownership table (or equivalent section listing agent wrappers), add `agentic-flow-review` with description `Cross-cutting review on the feature PR: security, architecture, acceptance criteria, test coverage`

- [x] T010 [P] Update `AGENTS.md` — two targeted additions: (1) in the pipeline overview table (or equivalent section showing pipeline stages), insert the `Review` stage between `Audit` and `Merge` with a brief description matching the pipeline table row in T009; (2) append a new Architecture Decision Record block with five ADR entries: (a) "Review stage fix loop uses `agentic-flow-implement` (not a new agent) — reusing the implement agent avoids defining a new agent and reuses battle-tested implementation machinery; findings are injected via the startup comment"; (b) "Iteration cap tracked by counting prior REQUEST_CHANGES context blocks on the PR — no persistence layer needed; PR comment history is the source of truth; five consecutive REQUEST_CHANGES without an APPROVE triggers human intervention"; (c) "`review-result-trigger.yml` (not the review agent) routes APPROVE/REQUEST_CHANGES — consistent with the existing pipeline pattern where GHA workflows react to agent outputs; more robust than agent-dispatched follow-up workflows"; (d) "Fix PRs use `agentic-flow-review-fix-pr` label to guard `implement-merge.yml` chain-advance — spec assumed no changes to `implement-merge.yml` were needed; analysis showed the chain-advance logic would incorrectly mark the PR ready when all sub-issues are already closed post-audit; targeted label guard is the minimal correct fix"; (e) "Fix branch naming: `review-fix/{feature-suffix}` reused across iterations — branches are deleted after their fix PR merges; reusing the same name keeps branch lists clean; concurrent-fix guard (FR-015) prevents collision"

**Checkpoint**: All documentation updated; pipeline table, labels table, wrapper ownership, and ADR entries accurately reflect the new Review stage (SC-007 met)

---

## Dependencies

```
T001 (assign-pr-agent) ←── T003 (review-dispatch uses stage: review)
T001 (assign-pr-agent) ←── T007 (review-fix-dispatch uses stage: review-fix)
T002 (implement-merge guards) ←── T007 (fix PRs with review-fix-pr label must not advance chain)
T003 (agent definition) ←── T004 (review-dispatch assigns agentic-flow-review)
T004 (review-dispatch) ←── T005 (audit-chain-trigger dispatches review-dispatch)
T004 (review-dispatch) ←── T008 (review-fix-complete-trigger re-dispatches review-dispatch)
T006 (review-result-trigger) ←── T007 (result-trigger dispatches review-fix-dispatch)
T007 (review-fix-dispatch) ←── T008 (fix-complete-trigger depends on fix PRs existing)
```

**Completion order by user story**:
- US1 complete when: T001 + T003 + T004 + T005 are merged
- US2 complete when: T003 is merged (agent definition content)
- US3 complete when: T001 + T002 + T006 + T007 + T008 are merged
- US4 complete when: T006 is merged (APPROVE handler)

---

## Parallel Execution per Story

**Foundational phase** (must be sequential within the phase, one depends on the other only via shared file):
- T001 and T002 touch different files and can be worked in parallel by different contributors

**US1 phase**:
- T003 (agent file) and T004 (dispatch workflow) are independent files — can be worked in parallel
- T005 (audit-chain-trigger modification) must follow T004 being ready on `main`; this is the live integration point and should be merged last

**US3 phase**:
- T006 (result-trigger), T007 (fix-dispatch), and T008 (fix-complete-trigger) are independent new files — can be worked in parallel
- T006 dispatches T007 at runtime, but T007 does not need to exist for T006 to be merged

**Polish phase**:
- T009 and T010 are independent documentation files — can be worked fully in parallel

---

## Implementation Strategy

**MVP scope** (US1 only — T001, T003, T004, T005):
Delivers the core integration point: review fires after audits pass, agent performs four-category check, result is posted. No automated fix loop yet — a REQUEST_CHANGES result leaves the PR in draft awaiting manual intervention. Sufficient to validate the full US1 acceptance scenarios end-to-end.

**Full delivery** (all tasks):
Adds the automated fix loop (T006, T007, T008), implement-merge guards (T002), and documentation (T009, T010). US3 and US4 acceptance scenarios require the full set.

**Safe deployment sequence** (from plan.md §8 — preserves live pipeline at each intermediate step):
1. T001 → 2. T002 → 3. T003 → 4. T004 → 5. T006 → 6. T007 → 7. T008 → 8. T005 (integration point, deploy last) → 9. T009 + T010

T005 (audit-chain-trigger) is the only change with immediate live-pipeline impact and must be the final merge.
