# Feature Specification: Agentic-Flow Framework Second-Iteration Remediation

**Feature Branch**: `002-framework-remediation`  
**Created**: 2025-07-22  
**Status**: Draft  
**Validation**: speckit.analyze (consistency) → `claude-opus-4.6` + `gpt-5.4`
technical review (Principle III) — both layers MUST PASS before human gate.

## Overview

The agentic-flow framework is a GitHub-native pipeline that carries feature issues through six
stages (triage → research → spec → plan → tasks → post-merge) with human approval gates at each
transition. A multi-model review of its first iteration identified five categories of defects
that prevent the framework from being used reliably in production. This feature covers the full
second-iteration remediation across all five categories.

## Clarifications

### Session 2026-04-10

- Q: How does the post-merge stage determine a sub-issue was already created (FR-018)? → A: Query existing sub-issues labelled `agentic-flow-task` on the feature issue and deduplicate by **title match** (e.g. `T001 — Title`); task ID is embedded in each sub-issue body for reference but is not the deduplication key.
- Q: What GitHub auth mechanism and token scopes does the post-merge AW require? → A: `GITHUB_TOKEN` with `issues: write` + `pull-requests: read` declared in `post-merge-trigger.yml`; the AW runtime forwards the same token via the `Authorization` header in `mcp-github.yml` — no additional secrets required.
- Q: How is the pipeline context block identified in spec PR comments (FR-013)? → A: By the existing `<!-- agentic-flow-context -->` HTML comment sentinel already present in `post-merge.yml`; the format is unchanged.
- Q: How are concurrent post-merge workflow runs serialised? → A: GHA `concurrency` group keyed to the feature issue number in `post-merge-trigger.yml`, `cancel-in-progress: false`; first run completes fully, subsequent runs queue then skip already-created sub-issues via title-match idempotency.
- Q: What is the throttling and retry strategy for batch sub-issue creation? → A: Sequential creation with no deliberate inter-call delay — natural MCP tool-call latency is sufficient; retry on HTTP 429; no hard cap on task count.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reliable Post-Merge Sub-Issue Creation (Priority: P1)

A developer using the framework in their own repository merges a feature branch. The post-merge
stage is supposed to read the task list produced by the tasks stage and automatically create one
GitHub sub-issue per task. Today this silently fails or produces incorrect output because the
post-merge stage expects a structured format that the tasks stage does not produce.

**Why this priority**: Silent failure at the final automation stage defeats the entire purpose of
the pipeline. Tasks are never tracked in GitHub Issues, manual follow-up is required every time,
and the failure is invisible to the developer. Nothing else matters if the pipeline cannot close
its own loop.

**Independent Test**: Merge a feature branch that has a completed tasks stage, trigger post-merge
manually, and verify that one GitHub sub-issue is created for each task listed in the tasks
output — without any manual intervention.

**Acceptance Scenarios**:

1. **Given** a merged feature branch with a valid completed tasks output, **When** the post-merge
   stage runs, **Then** one GitHub sub-issue is created for every task in that output with correct
   title and body, each sub-issue is labelled to identify it as a framework-generated task, and
   the parent feature issue is updated with links to all sub-issues.

2. **Given** the tasks stage has produced its output, **When** a contributor inspects that output
   directly, **Then** the format is unambiguous and machine-readable, and all fields required by
   the post-merge stage are present.

3. **Given** the tasks stage output is malformed or missing required fields, **When** the
   post-merge stage runs, **Then** it fails loudly with a descriptive error message rather than
   silently creating partial or zero sub-issues.

---

### User Story 2 — Successful Tagged Release (Priority: P2)

A maintainer pushes a version tag to trigger a release. Today every release fails because a
development-only configuration file that is forbidden by the release workflow's pre-flight
validation is present at the repository root, causing the workflow to abort before packaging begins.

**Why this priority**: The inability to cut a release blocks all downstream consumers of the
framework. Fixing this is a one-change unblock with no risk of regression.

**Independent Test**: Push a test tag from a clean checkout and observe the release workflow
completing successfully end-to-end without manual intervention.

**Acceptance Scenarios**:

1. **Given** a clean checkout of the repository, **When** a maintainer pushes a version tag,
   **Then** the release workflow completes successfully and produces a published release artifact.

2. **Given** the forbidden configuration file has been removed from the repository root, **When**
   the release workflow runs, **Then** the pre-flight validation passes and the workflow completes
   successfully without manual intervention.

---

### User Story 3 — Single Authoritative Source for Shared Workflow Logic (Priority: P3)

A contributor needs to update the PR-reassignment behaviour that is used across three pipeline
stages. Today that logic is copied verbatim in each stage, so the contributor must make the same
change in three places and risks the copies drifting out of sync.

**Why this priority**: Duplication is a maintenance liability. A bug fix applied to one copy will
be missed in the others, leading to inconsistent pipeline behaviour across stages. Extracting the
shared logic to a single location eliminates the entire class of drift-induced bugs.

**Independent Test**: Update the shared logic in one place, run all three stages that use it, and
verify all three behave consistently — without touching the individual stage definitions.

**Acceptance Scenarios**:

1. **Given** a change to the shared PR-reassignment logic, **When** that change is made in the
   single shared location, **Then** all three pipeline stages that use it automatically reflect
   the change without requiring edits to any individual stage file.

2. **Given** any two pipeline stages that previously duplicated the PR-reassignment logic,
   **When** their definitions are inspected, **Then** neither contains an inline copy of that
   logic — both reference the shared location.

---

### User Story 4 — Correct Pipeline Step Sequencing and Contextual Comments (Priority: P4)

A contributor following the pipeline encounters a workflow step that references a non-existent
subsequent step, and a post-merge comment that appears in the wrong context. These cause
confusion and require contributors to consult source files to understand what actually happens.

**Why this priority**: Incorrect step references and misplaced comments undermine contributor
trust in the pipeline documentation and make debugging harder. Each fix is low-risk and isolated.

**Independent Test**: Run through the triage stage and verify that every step reference in the
output points to a step that exists. Trigger a post-merge run and verify that each comment is
posted to the correct issue or PR with relevant context.

**Acceptance Scenarios**:

1. **Given** the triage stage is running, **When** Step 5 completes, **Then** any reference to a
   subsequent step points to a step that actually exists in the triage workflow.

2. **Given** the post-merge stage has finished creating task sub-issues, **When** it posts a
   summary comment, **Then** that comment is posted to the feature issue (not the spec PR) and
   summarises task sub-issues — not plan content.

3. **Given** the error-handler workflow targets a specific GitHub object (PR or issue),
   **When** an error occurs during a pipeline stage that has an associated spec PR, **Then** the
   error comment is posted to the spec PR, not the feature issue.

4. **Given** the spec PR has accumulated more than 100 comments, **When** the post-merge stage
   searches for the pipeline context block, **Then** it finds the context block regardless of
   comment volume.

---

### User Story 5 — Accurate, Internally Consistent Documentation (Priority: P5)

A new contributor reads the project documentation to understand what the framework does, who
maintains it, and what capabilities it provides. Today the documentation contradicts itself
across files, references agents that do not exist, and attributes ownership to people inconsistently.

**Why this priority**: Contradictory documentation erodes trust and causes new contributors to
make incorrect assumptions about what the framework can and cannot do. This is a correctness sweep
with no functional risk.

**Independent Test**: A new contributor reads only the documentation (no source files) and can
accurately describe: (a) whether dogfooding is active or planned, (b) which agents are available
to use, (c) who owns the project, and (d) what validation guarantees the framework currently
provides.

**Note on verification sequencing**: This story can be implemented and its documentation changes
delivered independently. However, its acceptance scenarios cannot be fully verified until US1–US4
remediation is observable, since the documentation must accurately reflect the post-remediation
state of the framework. This sequencing constraint applies to verification only, not delivery.

**Acceptance Scenarios**:

1. **Given** a new contributor reads `docs/contributing.md` and `AGENTS.md`, **When** they
   compare the two files' statements about dogfooding, **Then** both files agree on whether
   dogfooding is currently active or a future capability.

2. **Given** a contributor searches documentation for an agent by name, **When** they find that
   name in any documentation file, **Then** the referenced agent actually exists and is
   operational in the framework.

3. **Given** any documentation file that attributes project ownership, **When** all such files
   are compared, **Then** ownership is attributed consistently to the same person or entity.

4. **Given** the project constitution makes promises about validation coverage and test coverage,
   **When** those promises are compared against what is actually implemented, **Then** any
   unimplemented promises are clearly marked as aspirational targets rather than present-tense
   guarantees.

---

### Edge Cases

- What happens when the post-merge stage runs on a branch whose tasks output exists but contains
  zero tasks? (Expected: no sub-issues created, informational comment posted to feature issue.)
- What happens when a sub-issue creation fails midway through a batch? (Expected: partial
  completion is visible in the feature issue; a retry is possible without duplicating already-
  created sub-issues.)
- What happens if the shared workflow logic compilation step (verifying import support) determines
  that template imports are not supported by the compiler? (Expected: the extraction falls back to
  a reusable helper action rather than blocking the work item.)
- What happens when a tagged release is triggered concurrently with an open PR? (Expected: no
  interference; the release completes independently.)

## Requirements *(mandatory)*

### Functional Requirements

#### Tasks-Stage Automation Contract

- **FR-001**: The post-merge stage MUST be an Agentic Workflow (`post-merge.md`) triggered via
  `workflow_dispatch` from a standard GHA trigger shim (`post-merge-trigger.yml`) that fires on
  `pull_request: closed`. The agent MUST read `tasks.md` directly (using MCP file-access or
  checkout) and extract each task's identifier, title, description, and labels. The existing
  `post-merge.yml` JavaScript workflow is replaced entirely. The trigger shim MUST declare
  `permissions: { issues: write, pull-requests: read }` and MUST define a `concurrency` group
  keyed to the feature issue number with `cancel-in-progress: false` to serialise concurrent
  runs without cancelling an in-progress batch. The AW runtime forwards `GITHUB_TOKEN` via the
  `Authorization` header as configured in `mcp-github.yml`; no additional secrets are required.
- **FR-002**: The post-merge AW MUST create one GitHub sub-issue per task using MCP GitHub tools,
  without requiring any manual reformatting of `tasks.md`. Each created sub-issue MUST be labelled
  with `agentic-flow-task` so that all framework-generated tasks can be discovered and filtered
  independently of the feature issue they belong to. The agent MUST also update the feature issue
  with sub-issue links and post a summary comment. Sub-issues MUST be created sequentially with
  no deliberate inter-call delay; natural MCP tool-call latency is sufficient. The agent MUST
  retry on HTTP 429 responses; no hard cap on the number of tasks is imposed.
- **FR-003**: When `tasks.md` is absent or unreadable the post-merge AW MUST post a visible error
  comment to the feature issue and stop without creating any sub-issues. When `tasks.md` is present
  but a sub-issue creation fails partway through the batch, the agent MUST surface the partial
  completion — identifying which tasks succeeded and which failed — rather than failing silently.
- **FR-004**: `tasks.md` MUST follow a consistent structured format (task ID, title, description,
  labels) sufficient for the post-merge AW to parse reliably. The tasks stage template and all
  associated agent wrapper definitions MUST be updated to produce and maintain this format.

  > ✅ **Resolved (A1)**: The existing checklist format (`- [ ] T001 [P] [US1] Title — Description`)
  > satisfies this requirement without modification. The post-merge AW reads it directly via MCP
  > file-access. No template edits are required; this requirement is met by the format already in
  > production.
- **FR-018**: Sub-issue creation MUST be idempotent: rerunning the post-merge stage after a
  partial batch failure MUST NOT create duplicate sub-issues for tasks whose sub-issues were
  already successfully created in a prior run. Idempotency MUST be implemented by querying
  existing sub-issues labelled `agentic-flow-task` on the feature issue and comparing titles;
  a task is considered already materialised if an existing sub-issue title matches the task's
  title (format: `T001 — Title`). The task ID MUST also be embedded in each sub-issue body for
  reference, but title is the sole deduplication key.

#### Release Blocker

- **FR-005**: The repository root MUST NOT contain any file that the release workflow's
  pre-flight validation treats as forbidden; any such file MUST be removed or relocated to a
  path outside the paths the validation checks.
- **FR-006**: After remediation, the release workflow MUST complete successfully from a clean
  checkout when triggered by a version tag, with no manual intervention required.

#### Shared Workflow Code

- **FR-007**: Before any shared-code extraction is finalised, the build tooling MUST be verified
  to support or not support template imports; the extraction strategy MUST be chosen based on that
  verification result.
- **FR-008**: The PR-reassignment logic that currently appears verbatim in `plan.md`,
  `refine.md`, and `tasks.md` MUST reside in exactly one location after remediation.
- **FR-009**: The error-handler workflow MUST post error notifications to the spec PR, not the
  feature issue.
- **FR-010**: Shared content within the pipeline stage definitions identified in this
  remediation that the build tooling supports extracting to a template MUST be extracted;
  shared runtime logic that cannot be extracted via templates MUST be extracted to a reusable
  helper within the same scope.

#### Workflow Correctness

- **FR-011**: Every step reference within any pipeline stage definition MUST point to a step that
  exists in that same stage definition. At minimum, the triage stage definition MUST be corrected;
  all pipeline stage definitions MUST be verified by code inspection as part of this remediation.
- **FR-012**: The post-merge summary comment MUST be posted to the feature issue and MUST
  clearly identify itself as a task sub-issue summary; it MUST NOT use a heading or label that
  implies it is a plan summary or plan content.
- **FR-013**: The post-merge stage's search for the pipeline context block MUST paginate
  through all available comments on the spec PR rather than reading a fixed maximum page; it
  MUST locate the context block regardless of how many comments precede it. The pipeline context
  block is identified by the `<!-- agentic-flow-context -->` HTML comment sentinel already
  present in `post-merge.yml`; this sentinel format MUST remain unchanged.

#### Documentation Accuracy

- **FR-014**: All documentation files MUST agree on whether dogfooding of the framework is
  currently active or a future planned capability.
- **FR-015**: Every agent name referenced in any documentation file MUST correspond to an agent
  that exists in the framework; required agents MUST be operational, and optional agents MUST be
  explicitly marked as optional with their prerequisites stated; stale agent references MUST be
  removed or corrected.
- **FR-016**: All documentation files MUST attribute project ownership consistently to the same
  person or entity.
- **FR-017**: The project constitution MUST clearly distinguish between capabilities that are
  currently implemented and targets or aspirations that have not yet been implemented; no
  unimplemented capability MAY be stated in the present tense as if already delivered.

### Key Entities

- **Tasks-Stage Output**: The structured artifact produced at the end of the tasks stage. It is
  the authoritative source of truth for what work items post-merge automation must create. Its
  format is the contract between the tasks stage and the post-merge stage.
- **Pipeline Stage Definition**: A source file that defines the instructions, steps, and
  shared references for one stage of the agentic-flow pipeline (triage, research, spec, plan,
  tasks, post-merge).
- **Shared Logic Unit**: A single-source definition of logic (behaviour or content) used by
  more than one pipeline stage. After remediation, each shared logic unit MUST exist in exactly
  one place.
- **Release Workflow**: The automated process triggered by a version tag that validates and
  publishes a versioned artifact of the framework.
- **Project Constitution**: The document that defines the framework's operating principles,
  validation guarantees, and ownership. It is binding on all stage definitions and agent
  configurations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of post-merge runs against a valid completed tasks output successfully create
  the correct number of GitHub sub-issues, with zero silent partial-completion failures.
- **SC-002**: The release workflow succeeds on the first attempt from a clean checkout after
  remediation, with no manual intervention required.
- **SC-003**: The PR-reassignment workaround logic is defined in exactly one file
  (`src/.github/actions/assign-pr-agent/action.yml`) after remediation, down from 3 duplicate
  copies. The 3 consumer stage files (`plan.md`, `refine.md`, `tasks.md`) reference it via
  `uses: ./.github/actions/assign-pr-agent` — these are call sites, not definition locations,
  and do not count toward the location total. Verification: any change to the shared logic
  requires editing exactly 1 file.
- **SC-004**: Zero workflow step references in any pipeline stage point to non-existent steps,
  as verified by reading each stage's definition.
- **SC-005**: Zero documentation files contain agent names that do not correspond to an
  operational agent in the framework.
- **SC-006**: Zero contradictions exist between documentation files regarding dogfooding status,
  project ownership, or current vs. aspirational capabilities; any capability not yet implemented
  is explicitly labelled as aspirational or a future target, not stated in the present tense.
- **SC-007**: The error-handler workflow posts to the correct target (spec PR) in 100% of
  triggered scenarios.
- **SC-008**: Rerunning the post-merge stage after a partial batch failure produces no additional
  sub-issues for tasks already materialized in a previous run.

## Assumptions

- The `gh aw` compiler's support (or lack thereof) for template imports will be determined by
  empirical verification before implementation begins; the extraction strategy will be finalised
  only after that result is known.
- Hardcoded `main` branch references are tracked separately and are out of scope for this
  remediation.
- README overpromises on the product roadmap are tracked separately and are out of scope.
- The structured tasks-stage output format MUST be human-readable in addition to machine-readable
  so contributors can inspect it without tooling. The specific format (e.g., YAML front-matter
  in Markdown, standalone YAML) is an architectural decision that MUST be made and explicitly
  documented at the start of plan.md before any implementation begins; it is not deferred to
  implementation time.
- Skills (Copilot Skills) feasibility — whether they belong as dev-only tooling or shipped
  runtime — will be assessed as a spike during this remediation and its outcome will inform
  future features but will not block any of the five remediation areas above.
- All five remediation areas are independent enough to be implemented in parallel by different
  contributors, provided the tasks-stage automation contract (Area 1) is decided first, as
  Area 5 (docs) depends on Areas 1–4 being complete.
- The existing `workflow-templates/` directory and its contents will be evaluated during
  implementation; if the compiler does not support imports from it, it will be repurposed or
  removed rather than left as dead code.
