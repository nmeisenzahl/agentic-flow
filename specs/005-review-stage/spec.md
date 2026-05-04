# Feature Specification: Automated Review Stage

**Feature Branch**: `005-review-stage`
**Created**: 2025-07-27
**Status**: Draft
**Validation**: speckit.analyze (consistency) → `claude-opus-4.6` + `gpt-5.4`
technical review (Principle III) — both layers MUST PASS before human gate.

## Overview

The agentic-flow pipeline currently ends its automated phase the moment all audit task issues are
closed with APPROVE: the feature PR is immediately un-drafted and marked ready for human merge.
This leaves a gap — the audits validate individual tasks in isolation but nothing performs a
holistic, cross-cutting check of the complete feature branch before the human gate.

This feature inserts a new **Review stage** between audit completion and human merge. The Review
stage runs an automated agent (`agentic-flow-review`) against the fully-assembled feature PR,
performing four standardised cross-cutting checks: security, architecture, acceptance-criteria
coverage, and test coverage. When issues are found the pipeline dispatches a fix agent, waits for
the fix to land, and re-runs the review automatically. Only when the review passes does the
feature PR proceed to the existing human-merge gate.

## Clarifications

All key design decisions have been pre-confirmed by the feature author:

- **Agent identity**: A new, separate agent `agentic-flow-review` (not reusing `agentic-flow-audit`)
- **Trigger point**: Replaces the current "mark PR ready for human merge" step in `audit-chain-trigger.yml`; the review fires automatically after all audits pass
- **No sub-issue per run**: The review agent operates directly on the feature PR without creating a review task sub-issue
- **Fix dispatch**: On REQUEST_CHANGES, the review agent dispatches the existing `agentic-flow-implement` agent via a new `review-fix-dispatch.yml` workflow (reusing the existing implement machinery with review-finding context injected), targeting a short-lived fix branch off the feature branch
- **Auto re-run**: After the fix task PR merges into the feature branch, a new `review-fix-complete-trigger.yml` re-dispatches `review-dispatch.yml` automatically — no manual `/rerun-review` command

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Review Fires Automatically After All Audits Pass (Priority: P1)

All audit task issues have been closed with APPROVE. Under the current pipeline, the feature PR
would immediately be marked ready for human merge. With the Review stage installed, the pipeline
instead dispatches the review agent to the feature PR. No human action is needed and no new issue
is created — the review simply runs.

**Why this priority**: This is the core integration point. Without it, the Review stage is never
reached. Everything else in this feature depends on the pipeline correctly transitioning from
audit completion to review dispatch rather than to the human-merge gate.

**Independent Test**: Close the last open audit task issue with APPROVE on a feature that has a
complete feature PR. Verify that the feature PR is NOT immediately un-drafted and that the review
agent is dispatched to it within the same automated run — delivering the transition from audit
to review without any human input.

**Acceptance Scenarios**:

1. **Given** all audit task issues for a feature are closed with APPROVE, **When** the last audit
   task closes, **Then** the pipeline dispatches the review agent to the feature PR instead of
   marking it ready for human merge.

2. **Given** the review agent has been dispatched to the feature PR, **When** the agent starts,
   **Then** it can read the feature's spec directory, the full diff of the feature branch, and
   all pipeline context — and the feature PR remains in draft state during the review.

3. **Given** at least one audit task issue is still open, **When** an audit task closes,
   **Then** the review stage is NOT dispatched (the audit chain continues to the next audit task
   as before).

---

### User Story 2 — Review Performs Four-Category Cross-Cutting Check (Priority: P2)

The review agent examines the complete feature branch and applies four categories of standardised
checks: security vulnerabilities, architectural consistency, acceptance-criteria coverage, and
test coverage of critical paths. Each category produces a clear pass or fail with specific
findings attached.

**Why this priority**: The four-category check is the core value proposition of the Review stage.
Without it, the stage is a no-op that adds latency without adding quality gates.

**Independent Test**: Dispatch the review agent to a feature PR that contains a known security
issue (e.g. a hardcoded secret), an architecture inconsistency, an unmet acceptance criterion,
and an untested code path. Verify that the agent's PR review cites a finding in each of the four
categories before returning REQUEST_CHANGES.

**Acceptance Scenarios**:

1. **Given** a feature branch containing a hardcoded credential, **When** the review runs,
   **Then** the security check identifies the finding and includes it in the review findings
   posted to the feature PR.

2. **Given** a feature branch that deviates from the architecture decisions documented in
   `plan.md`, **When** the review runs, **Then** the architecture check flags the deviation with
   a reference to the relevant plan section.

3. **Given** a feature branch where one acceptance criterion from `spec.md` has no corresponding
   implementation or test, **When** the review runs, **Then** the acceptance-criteria check
   identifies the gap by quoting the unmet criterion.

4. **Given** a feature branch with a critical path that has no test coverage, **When** the review
   runs, **Then** the coverage check identifies the specific path as untested.

5. **Given** a feature branch that passes all four checks cleanly, **When** the review runs,
   **Then** the agent posts APPROVE and the pipeline advances to the human-merge gate.

---

### User Story 3 — Issues Found Trigger an Automated Fix Loop (Priority: P3)

The review agent identifies issues and posts REQUEST_CHANGES. Rather than stopping and waiting
for a human to manually fix the code, the pipeline automatically dispatches a coding agent with
the review findings as context. The coding agent creates a fix branch off the feature branch,
implements the necessary changes, and creates a fix task PR targeting the feature branch. After
the fix task PR auto-merges, the review re-runs against the updated feature branch.

**Why this priority**: The automated fix loop is what makes the Review stage non-blocking for the
pipeline. Without it, a REQUEST_CHANGES result would stall the pipeline until manual intervention.
The fix loop closes the quality gate automatically while preserving the human gate at the end.

**Independent Test**: Dispatch the review agent to a feature PR with a known issue. Verify that
(1) a fix branch is created off the feature branch, (2) the implement agent is assigned to that
branch with the review findings visible in its context, (3) after the implement agent labels the
fix PR `ready-to-merge-task`, it auto-merges into the feature branch, and (4) the review agent
is re-dispatched to the feature PR automatically — all without human intervention.

**Acceptance Scenarios**:

1. **Given** the review agent posts REQUEST_CHANGES on a feature PR, **When** the dispatch step
   runs, **Then** a fix branch is created off the feature branch and the implement agent is
   assigned to a fix task PR targeting the feature branch, with the review findings embedded in
   the agent's startup context.

2. **Given** the implement agent completes its work on the fix branch and labels the fix task PR
   `ready-to-merge-task`, **When** the auto-merge trigger fires, **Then** the fix task PR merges
   into the feature branch without human action.

3. **Given** the fix task PR has merged into the feature branch, **When** the re-run trigger
   fires, **Then** `review-dispatch.yml` is called again for the same feature PR — repeating the
   review cycle from the beginning.

4. **Given** the re-dispatched review now finds all checks passing, **When** the review agent
   posts APPROVE, **Then** the feature PR is un-drafted, labelled `implementation-complete`, and
   a "Ready for Human Merge" comment is posted — ending the fix loop.

---

### User Story 4 — Review Pass Hands Off to the Human Gate (Priority: P4)

When the review agent approves all four check categories, the pipeline transitions to the same
human-merge gate that previously followed audit completion: the feature PR is marked non-draft,
the `implementation-complete` label is applied, and a clear summary comment is posted on both
the feature issue and the feature PR.

**Why this priority**: The hand-off to the human gate must be identical in outcome to what the
current pipeline produces so that human reviewers see the same signals regardless of whether
a fix loop occurred. This is a correctness requirement, not a new behaviour.

**Independent Test**: Run a review that passes on the first attempt and verify the feature PR
state, label, and comment match exactly what the current `audit-chain-trigger.yml` would have
produced if it had marked the PR ready directly.

**Acceptance Scenarios**:

1. **Given** the review agent posts APPROVE (on first run or after a successful fix loop), **When**
   the pipeline processes the APPROVE result, **Then** the feature PR is un-drafted, labelled
   `implementation-complete`, and a summary comment listing all completed audits and the review
   result is posted on the feature issue and feature PR.

2. **Given** the feature PR has been marked ready for human merge, **When** a human reviewer
   opens the feature PR, **Then** the PR is not in draft, shows the `implementation-complete`
   label, and the most recent comment clearly states all automated checks have passed.

---

### Edge Cases

- **All audits pass but review dispatch fails**: The `audit-chain-trigger.yml` must not silently
  fall through to the old "mark ready" path if the review dispatch call errors — it should post
  an error comment and leave the feature PR in draft.
- **Fix loop does not converge**: If the review continues to post REQUEST_CHANGES after multiple
  fix loop iterations, the pipeline must not loop indefinitely. A maximum iteration count is
  enforced; on breach, the pipeline halts and posts an error comment requesting human intervention.
- **Fix task PR is closed without merging**: The re-run trigger must not fire if the fix task PR
  is closed without being merged; the pipeline should surface an error and await human action.
- **Review agent is dispatched to an already-approved PR**: If the feature PR already has an
  APPROVE from a prior review run (e.g. a spurious re-dispatch), the agent must detect this and
  exit cleanly without repeating the human-gate handoff steps.
- **Audit task closes without a genuine APPROVE context block**: The existing `audit-chain-trigger.yml`
  guard that verifies the APPROVE context block must continue to function; the review dispatch
  only fires when this guard passes.
- **Concurrent fix branches**: Only one fix branch per feature branch at a time; the dispatch
  must check for an existing open fix task PR before creating a new one.

## Requirements *(mandatory)*

### Functional Requirements

#### Pipeline Integration

- **FR-001**: The pipeline MUST dispatch the Review stage automatically after the last open audit
  task issue for a feature closes with a verified APPROVE context block — replacing the current
  "mark feature PR ready for human merge" step in `audit-chain-trigger.yml`.

- **FR-002**: `audit-chain-trigger.yml` MUST NOT mark the feature PR ready for human merge
  directly; instead it MUST invoke `review-dispatch.yml` when `open_audit_count == '0'` and the
  APPROVE guard passes.

- **FR-003**: The Review stage MUST NOT create a sub-issue per run. The review agent is assigned
  directly to the feature PR; the feature issue gains no new child issues as a result of the
  review running.

- **FR-004**: The review agent MUST post a machine-parseable structured context block on the
  feature PR that identifies the review phase, result (APPROVE or REQUEST_CHANGES), and the
  feature context — following the same `<!-- agentic-flow-context -->` sentinel convention used
  by the audit stage.

#### Review Checks

- **FR-005**: The review agent MUST perform a **security check** covering: hardcoded credentials
  or secrets, unsafe handling of user-supplied input, injection-pattern anti-patterns, and
  references to dependency versions with known published vulnerabilities.

- **FR-006**: The review agent MUST perform an **architecture check** covering: adherence to all
  design decisions recorded in `{spec_directory}/plan.md`, absence of unintended coupling between
  components that the plan treats as independent, and consistency of naming and structural
  patterns with the rest of the feature branch.

- **FR-007**: The review agent MUST perform an **acceptance-criteria check**: for every
  acceptance criterion listed in `{spec_directory}/spec.md`, it must confirm that the feature
  branch contains implementation and/or tests that address it. Unmet criteria must be listed
  individually in the findings.

- **FR-008**: The review agent MUST perform a **coverage check** covering: presence of tests for
  each critical path identified in the tasks (drawn from `{spec_directory}/tasks.md`), and
  obvious untested branches in new code (e.g. error handlers, boundary conditions) that have no
  corresponding test case.

- **FR-009**: A review run that finds zero issues across all four categories MUST result in an
  APPROVE outcome; any single finding in any category MUST result in a REQUEST_CHANGES outcome.

#### Fix Loop

- **FR-010**: On REQUEST_CHANGES, the review agent MUST post a structured findings comment on the
  feature PR listing every identified issue with sufficient detail for a coding agent to act on
  it (file path, description, and remediation guidance where applicable).

- **FR-011**: On REQUEST_CHANGES, the pipeline MUST automatically dispatch a fix agent to the
  feature branch. The fix agent MUST be `agentic-flow-implement`, invoked via a new
  `review-fix-dispatch.yml` workflow. The review findings MUST be injected into the fix agent's
  startup context.

- **FR-012**: `review-fix-dispatch.yml` MUST create a short-lived fix branch off the tip of the
  feature branch and open a fix task PR targeting the feature branch — following the same
  branch-and-PR setup pattern used by `implement-dispatch.yml`.

- **FR-013**: After the fix task PR auto-merges into the feature branch (via the existing
  `implement-merge.yml` `ready-to-merge-task` label path), a new `review-fix-complete-trigger.yml`
  MUST detect the merge and re-dispatch `review-dispatch.yml` for the same feature PR.

- **FR-014**: The fix loop MUST enforce a maximum iteration limit of **5 review cycles**. If the
  review posts REQUEST_CHANGES for a fifth consecutive time without an intervening APPROVE, the
  pipeline MUST halt, post an error comment on the feature PR and feature issue requesting human
  intervention, and leave the feature PR in draft.

- **FR-015**: `review-fix-dispatch.yml` MUST guard against concurrent fix branches: if an open
  fix task PR targeting the feature branch already exists, it MUST skip creating a new one and
  post a warning comment instead.

#### Human-Gate Handoff

- **FR-016**: When the review agent posts APPROVE (on any iteration), the pipeline MUST un-draft
  the feature PR, apply the `implementation-complete` label to the feature issue, and post a
  "Ready for Human Merge" summary comment on both the feature issue and the feature PR —
  identical in content to what the current `audit-chain-trigger.yml` produces today.

- **FR-017**: The summary comment posted on APPROVE MUST list all completed audit tasks and
  confirm the Review stage result, so that the human reviewer has a complete audit trail in a
  single comment.

#### Documentation and Configuration

- **FR-018**: `src/.github/copilot/instructions.md` MUST be updated to add the Review stage to
  the pipeline table (between Audit and Merge) and to add any new labels introduced by this
  feature to the Labels table.

- **FR-019**: `AGENTS.md` MUST be updated to include the Review stage in the pipeline overview
  and to record an Architecture Decision Record (ADR) documenting the fix-loop design decisions
  confirmed above.

### Key Entities

- **Review Run**: A single execution of the review stage against a feature PR. Has an outcome
  (APPROVE or REQUEST_CHANGES), a list of findings per check category, and a reference to the
  feature PR and spec directory it was run against.

- **Review Finding**: An individual issue identified during a review run. Belongs to exactly one
  check category (security, architecture, acceptance criteria, or coverage), references a
  specific file or spec section, and carries a remediation description for the fix agent.

- **Fix Branch**: A short-lived branch created off the feature branch to address a set of review
  findings. Created by `review-fix-dispatch.yml`, targeted by a fix task PR, and deleted after
  the fix task PR merges. Named `review-fix/{feature-branch-suffix}` or similar.

- **Fix Task PR**: A pull request from a fix branch targeting the feature branch. Auto-merged by
  the existing `implement-merge.yml` mechanism when labelled `ready-to-merge-task`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the last audit task closes with APPROVE, the review agent is dispatched to the
  feature PR in a fully automated manner — no human action, no slash command, and no manual
  workflow trigger required.

- **SC-002**: A feature PR that contains at least one issue in any of the four check categories
  receives a REQUEST_CHANGES review from the review agent; a feature PR that contains zero issues
  across all four categories receives an APPROVE review.

- **SC-003**: After a REQUEST_CHANGES result, the fix agent receives the review findings as
  structured context, implements changes on a fix branch, and the fix branch merges back into the
  feature branch — all without human intervention.

- **SC-004**: After the fix merges, the review re-dispatches and completes another full four-
  category check — without a human triggering it.

- **SC-005**: A feature PR that passes the review (on any iteration) reaches the same
  human-merge-ready state — non-draft, `implementation-complete` label, summary comment — as the
  current pipeline produces today after audit completion.

- **SC-006**: A fix loop that does not converge within 5 iterations halts with a visible error
  comment rather than running indefinitely.

- **SC-007**: The pipeline table in `src/.github/copilot/instructions.md` and the pipeline
  overview in `AGENTS.md` both accurately reflect the new Review stage placement and behaviour
  after this feature is merged.

## Assumptions

- The existing `assign-pr-agent` composite action requires two new stage branches (`review` and
  `review-fix`) added to `main.js`; the `action.yml` input interface is otherwise unchanged.
- `implement-merge.yml` requires a targeted label guard (`agentic-flow-review-fix-pr`) on the
  "close task issue" and "find next task or dispatch audit" steps to prevent fix PRs from
  triggering the chain-advance logic incorrectly (all sub-issues are already closed post-audit).
  The outer `if:` condition must also be extended to match `review-fix/` branch prefixes.
- The `GH_AW_AGENT_TOKEN` secret already in use by audit and implement workflows has sufficient
  permissions to dispatch workflows, manage PR draft state, apply labels, and post comments —
  the review workflows will use the same secret.
- The review agent's four check categories are best-effort static analysis and semantic review
  based on the contents of the repository; no external scanning tools or APIs are required. The
  agent uses the same `read`, `search`, `execute`, and GitHub MCP tools already available to
  `agentic-flow-audit`.
- The `review-fix-complete-trigger.yml` identifies fix task PRs by detecting merges of PRs
  labelled exclusively `agentic-flow-review-fix-pr` targeting the feature branch. Using
  `agentic-flow-task-pr` alone is unsafe — it would fire on all regular implement-stage task
  PR merges and break the existing pipeline.
- Review findings from a prior iteration do not need to persist between runs; each review run
  reads the current state of the feature branch and generates a fresh set of findings.
- The maximum fix loop iteration count (5) is enforced by a counter embedded in the review
  context block comments; the trigger workflow reads this counter before each re-dispatch.
- Mobile and CLI client support is out of scope; all interactions are GitHub web UI and GitHub
  Actions only.
