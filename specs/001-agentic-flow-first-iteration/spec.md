# Feature Specification: agentic-flow — Automated Issue-to-Task Pipeline Framework

**Feature Branch**: `001-agentic-flow-first-iteration`  
**Created**: 2026-04-09  
**Status**: Baseline (retroactive — documents framework as-built)  
**Input**: User description: "Current state of the agentic-flow framework — a GitHub-native pipeline that takes a raw feature issue from triage through spec, plan, and task generation, with human approval gates at each stage and automated post-merge sub-issue creation."  
**Validation**: speckit.analyze (consistency) → `claude-opus-4.6` + `gpt-5.4`
technical review (Principle III) — both layers MUST PASS before human gate.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Feature issue is automatically triaged and classified (Priority: P1)

A developer on a team that has adopted agentic-flow opens a raw GitHub issue to request a new feature or report a need. Within minutes, the Copilot pipeline reads the issue, formats it into a standardised Feature Issue structure, applies the appropriate classification label (`needs-spec` for actionable features, `needs-refinement` if the description is too thin to specify), and posts a summary comment. The developer does not have to do anything beyond writing the initial request.

**Why this priority**: Triage is the entry point to the entire pipeline. Every other phase depends on a correctly formatted and labelled Feature Issue being produced here. Without it, the automation cannot proceed and the team sees no value from the framework.

**Independent Test**: Can be fully tested by opening a single issue with a short feature description and verifying the issue is reformatted and labelled within one workflow run, without any further human action.

**Acceptance Scenarios**:

1. **Given** a repo with agentic-flow installed and a GitHub Actions runner available, **When** a developer opens a new issue with a descriptive title and body, **Then** the triage agent runs, reformats the issue into the canonical Feature Issue structure, and applies either `needs-spec` or `needs-refinement` within a single workflow run.
2. **Given** an issue that is too vague to spec, **When** triage runs, **Then** the issue is labelled `needs-refinement` and a comment explains what additional detail is needed before spec can proceed.
3. **Given** a previously triaged issue that still needs work, **When** a maintainer posts `/retry-triage`, **Then** the triage agent re-evaluates the issue and updates labels and formatting accordingly.
4. **Given** a repo without the `needs-spec` or `needs-refinement` labels, **When** triage runs for the first time, **Then** the agent creates the missing labels before applying them.

---

### User Story 2 — Maintainer triggers spec generation and receives a ready-to-review spec PR (Priority: P1)

After a Feature Issue has been triaged and labelled `needs-spec`, a research phase runs automatically (adding `research-in-progress`, then `research-complete` once done) to gather context and relevant findings. Once research is complete, a maintainer or lead posts `/start-spec` as a comment on the Feature Issue — but only when the `research-complete` label is present and `needs-refinement` is absent. The pipeline kicks off the spec phase: a spec PR is opened, the `agentic-flow-spec` wrapper agent runs speckit's spec, clarify, and analyze phases, and a structured context block is posted as a PR comment that subsequent pipeline phases will read. The maintainer reviews the spec PR and can proceed to approval or request refinement.

**Why this priority**: The spec phase is the first formal gate. A complete, reviewed spec is the prerequisite for every later phase. Without a reliable spec trigger and PR creation flow, the pipeline stalls.

**Independent Test**: Can be fully tested by posting `/start-spec` on a triaged Feature Issue (with `research-complete` label present) and verifying that a PR is opened with a `spec.md` file and a structured context block comment, without any further configuration.

**Acceptance Scenarios**:

1. **Given** a Feature Issue with `research-complete` label present and `needs-refinement` absent, **When** a maintainer posts `/start-spec`, **Then** the pipeline opens a spec PR with `spec.md` committed to the branch and a structured context block posted as a PR comment.
2. **Given** a Feature Issue with `needs-refinement` or without `research-complete`, **When** `/start-spec` is posted, **Then** the pipeline rejects the command with a clear recovery comment explaining the unmet precondition.
3. **Given** the spec PR is open, **When** a maintainer reviews `spec.md` and finds it incomplete, **Then** they post `/refine-spec` as a PR comment, the refine agent updates `spec.md` on the same branch, and no new PR is created.
4. **Given** the spec PR is open and `spec.md` is satisfactory, **When** a maintainer posts `/approve-spec` as a PR comment, **Then** the plan phase begins automatically and `agentic-flow-plan` produces `plan.md` on the same branch.

---

### User Story 3 — Plan and tasks are generated through structured approval gates (Priority: P1)

Once the spec is approved, the pipeline continues without branching or creating new PRs. The `agentic-flow-plan` wrapper agent generates `plan.md` on the existing spec branch. The maintainer reviews it, and on `/approve-plan`, `agentic-flow-tasks` generates `tasks.md` (containing a structured list of implementation tasks) on the same branch. The maintainer then merges the PR. Throughout this flow, every agent reads a structured context block posted as the latest trusted comment on the spec PR to understand what phase it is in and what artefacts already exist.

**Why this priority**: The plan and tasks phases are the output the team actually uses. A reliable end-to-end progression from spec approval to a merged PR with tasks is the core value proposition.

**Independent Test**: Can be tested by posting `/approve-spec` on a spec PR and verifying that `plan.md` appears on the branch, then posting `/approve-plan` and verifying `tasks.md` appears, all without creating additional branches or PRs.

**Acceptance Scenarios**:

1. **Given** a spec PR with an approved `spec.md`, **When** `/approve-spec` is posted, **Then** `agentic-flow-plan` runs, `plan.md` is committed to the same branch, and a summary comment is posted on the PR.
2. **Given** a spec PR with `plan.md` committed, **When** `/approve-plan` is posted, **Then** `agentic-flow-tasks` runs, `tasks.md` is committed to the same branch, and the PR is labelled `ready-to-merge`.
3. **Given** a spec PR labelled `ready-to-merge`, **When** the PR is merged, **Then** the post-merge workflow fires and task sub-issues are created in the repository.
4. **Given** any phase failure (agent error, compile error, unexpected content), **When** the failure occurs, **Then** the agent posts a recovery comment on the spec PR explaining what failed and what the next step is, without leaving the PR in an ambiguous state.

---

### User Story 4 — Post-merge automation creates a sub-issue for each task (Priority: P2)

After the spec PR is merged, the pipeline parses `tasks.md` and creates one GitHub sub-issue per task. Each sub-issue is linked to the original Feature Issue, carries the relevant labels, and contains the task title and description as defined in the tasks stage output.

**Why this priority**: Post-merge automation is the bridge between the spec pipeline and actual implementation work. Teams need the task issues to appear in their backlog automatically; manual creation defeats the purpose.

**Independent Test**: Can be tested by merging a spec PR that contains a known `tasks.md` and verifying the expected number of sub-issues are created with correct titles and parent linkage.

**Acceptance Scenarios**:

1. **Given** a merged spec PR with `tasks.md` defining N tasks, **When** the post-merge workflow runs, **Then** N sub-issues are created in the repository, each linked to the original Feature Issue.
2. **Given** a merged spec PR where the Feature Issue has been closed or deleted, **When** the post-merge workflow attempts to create sub-issues, **Then** it fails gracefully with a clear error comment rather than crashing silently.
3. **Given** sub-issues are created successfully, **When** the workflow completes, **Then** a summary comment is posted on the Feature Issue listing the created sub-issues.

---

### User Story 5 — Framework user installs agentic-flow into a new repository (Priority: P2)

A developer or team wants to adopt the framework in their own repository. They download the release zip from the framework's GitHub Releases page and extract it into the repository root, which places all framework files under `.github/`. Separately, they run `specify init` (from the speckit CLI) to install the speckit phase agents that the wrapper agents depend on. After both steps, the team compiles the workflow sources and commits the compiled results. Before the pipeline is functional, the team must also configure two repository secrets — a fine-grained PAT for Copilot engine calls and a fine-grained PAT for the agent assignment mechanism used by the plan, refine, and tasks phases. Once secrets are in place, no additional workflow authoring or agent configuration is required to start the basic pipeline.

**Why this priority**: Adoption is the distribution model's core job. If installation is error-prone or requires undocumented steps, adoption fails.

**Independent Test**: Can be tested by extracting the release zip into a blank repository, running `specify init` for speckit, compiling all workflow sources, configuring the required secrets, and verifying that a test issue triggers triage correctly.

**Acceptance Scenarios**:

1. **Given** a blank GitHub repository and the current release zip, **When** a developer extracts the zip into the repository root, **Then** all framework files are placed under `.github/` and the workflow compilation step succeeds without errors for every workflow source.
2. **Given** a fresh installation with the required secrets configured, **When** the team opens a test issue, **Then** the triage workflow fires and the issue is processed without any additional configuration.
3. **Given** a fresh installation where the required PATs are not yet added as repository secrets, **When** a workflow fires, **Then** it exits immediately with an explicit error identifying the missing secret rather than proceeding with a partial execution.
4. **Given** an existing installation that needs upgrading, **When** a new release zip is applied via `specify init`, **Then** the existing files are replaced cleanly and the pipeline continues to function.

---

### User Story 6 — Framework developer ships a new version via the release workflow (Priority: P3)

A contributor making changes to the framework source files in `src/` wants to ship a new release. They push a tag (`v*`), which triggers `release.yml`. The workflow validates all required files are present, checks that no forbidden files are included, assembles the distribution zip (stripping the `src/` prefix so files land under `.github/` on extraction), and publishes a GitHub Release with the zip attached.

**Why this priority**: The release workflow is internal tooling that only framework contributors use. It is important but does not directly affect adopters until a tag is pushed.

**Independent Test**: Can be tested by pushing a tag on a branch with a known set of source files and verifying the resulting zip contains the correct file tree without the `src/` prefix and without forbidden files.

**Acceptance Scenarios**:

1. **Given** a tag push on a branch where all required framework files are present, **When** `release.yml` runs, **Then** the zip is assembled, validated, and published as a GitHub Release asset without manual intervention.
2. **Given** a published release, **When** an adopter downloads the zip and extracts it, **Then** all files appear under `.github/` with no `src/` prefix and the installation is functional.

---

### Edge Cases

- What happens when a slash command is posted on an issue that is not yet in the correct pipeline state (e.g., `/approve-spec` before a spec PR exists)? — The workflow should detect the missing precondition and post a clear error rather than silently failing or producing a partial result.
- What happens when the research phase produces no findings? — Research should still post a findings section (even if minimal) so the context block is populated and subsequent phases are not blocked.
- What happens when two slash commands are posted concurrently on the same PR? — The GitHub Actions concurrency model should prevent parallel pipeline runs from the same source; only one run should proceed.
- What happens when a spec PR branch is deleted before the pipeline completes? — The pipeline agent should detect the missing branch and post a recovery comment on the Feature Issue.
- What happens when `tasks.md` contains no tasks? — Post-merge should handle an empty task list gracefully without creating zero-title sub-issues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically process any new GitHub issue through the triage phase within one workflow run, without human intervention beyond issue creation.
- **FR-002**: System MUST label triaged issues with `needs-spec` (actionable) or `needs-refinement` (insufficient detail), creating those labels if they do not already exist.
- **FR-002a**: System MUST manage the following six pipeline state labels throughout the lifecycle: `needs-spec`, `needs-refinement`, `research-in-progress`, `research-complete`, `spec-in-progress`, and `ready-to-merge`. Each label must be applied and removed at the correct phase transitions as the canonical signal between workflow steps.
- **FR-003**: System MUST trigger the research phase automatically after triage classifies an issue as actionable and applies the feature label, with a fallback trigger when the feature label is applied manually. The research phase MUST apply a `research-in-progress` label while running and replace it with `research-complete` upon appending findings to the Feature Issue.
- **FR-004**: System MUST open a spec PR and apply the `spec-in-progress` label when `/start-spec` is posted on a Feature Issue that has `research-complete` and does not have `needs-refinement`; if preconditions are unmet the system MUST reject the command with a recovery comment.
- **FR-005**: System MUST use a single branch and single PR for all pipeline phases from spec through tasks; no additional branches or PRs are created after `/start-spec`.
- **FR-006**: System MUST post a structured machine-readable context block as a PR comment before each agent phase and update it after each phase completes, as the canonical handoff contract between phases.
- **FR-007**: System MUST allow spec refinement via `/refine-spec` on the spec PR, updating `spec.md` in-place without creating a new branch or PR.
- **FR-008**: System MUST generate `plan.md` on the spec branch when `/approve-spec` is posted, using the `agentic-flow-plan` wrapper agent.
- **FR-009**: System MUST generate `tasks.md` on the spec branch when `/approve-plan` is posted, using the `agentic-flow-tasks` wrapper agent, and apply the `ready-to-merge` label.
- **FR-010**: System MUST create one GitHub sub-issue per task defined in `tasks.md` when the spec PR is merged, linking each sub-issue to the original Feature Issue.
- **FR-011**: System MUST post a recovery comment on the spec PR (or Feature Issue, if no PR exists) whenever an agent phase fails, stating what failed and what the next step is.
- **FR-012**: System MUST be distributable as a zip file that, when extracted into an adopter repository root, places all framework files under `.github/` with no path prefix, and adopters compile the workflow sources locally before the workflows are active.

### Key Entities

- **Feature Issue**: The GitHub Issue that represents the feature request; the entry point and persistent anchor for the entire pipeline. Contains the original request, research findings, and pipeline status labels.
- **Spec PR**: The single GitHub Pull Request that carries all pipeline artefacts (`spec.md`, `plan.md`, `tasks.md`) on one branch. Human review and slash commands happen here.
- **agentic-flow-context block**: A machine-readable handoff marker posted as the latest trusted comment on the spec PR. Captures the current pipeline phase, relevant artefact paths, and agent configuration so each wrapper agent can resume from the correct state without reading git history.
- **Wrapper Agent**: A Copilot agent file that adapts a speckit phase (spec, plan, or tasks) to the agentic-flow PR-first pipeline model. There are three: `agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`. Each operates strictly on the already-open spec PR — it never creates a new branch or PR.
- **Workflow Source**: An agentic workflow file that defines the GitHub Actions triggers, steps, and agent invocations for a pipeline phase. Each source is compiled locally by adopters into a deployable GitHub Actions workflow file before being committed.
- **Release Zip**: The distributable archive produced by the framework release pipeline. Contains all framework files ready to be placed under `.github/` in an adopter repository via `specify init`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can complete the full pipeline from opening a feature issue to a merged PR containing `spec.md`, `plan.md`, and `tasks.md` without writing any workflow configuration or manually orchestrating any phase — all progression is triggered by issue creation or slash commands.
- **SC-002**: Every pipeline phase transition (triage → research → spec → plan → tasks → post-merge) is triggered by a single human action (issue creation or slash command), with no intermediate manual steps required.
- **SC-003**: All agent-phase failures surface a human-readable recovery comment on the spec PR within the same workflow run that encountered the failure — no silent failures.
- **SC-004**: Post-merge sub-issue creation produces one sub-issue per task entry in `tasks.md`, correctly linked to the Feature Issue, in a single workflow run after the PR is merged.
- **SC-005**: A fresh installation from the release package, with secrets and permissions configured as documented, produces a working pipeline (triage triggers correctly) without any additional workflow authoring by the adopter.

## Assumptions

- Teams adopting the framework have GitHub Actions enabled and the Copilot Agentic Workflows CLI available in their environment.
- Three tokens are required in the adopting repository: the built-in `GITHUB_TOKEN` (for standard GitHub API access), a fine-grained PAT for Copilot engine calls, and a fine-grained PAT for the PR-based agent assignment workaround used by the plan, refine, and tasks phases. All three must be configured before the pipeline is functional.
- The `GITHUB_TOKEN` permissions in adopter repos include write access to issues, pull requests, and contents.
- Adopter teams must have speckit (`.specify/`) already installed and configured in their repository before installing agentic-flow. The framework's wrapper agents adapt speckit's phase outputs to the PR-first pipeline model; they do not replace speckit or bootstrap it.
- The workflow compilation step is run locally by adopters after installation and the resulting compiled workflow files are committed to the adopter repo. The framework does not ship pre-compiled workflows.
- Framework distribution is one-way: the release package is consumed by adopters. Adopters do not push changes back to the framework repo.
- The pipeline operates on public or private repositories where GitHub-hosted Copilot agents have access. Self-hosted or enterprise-only agent environments are out of scope for this baseline.
- A single maintainer or lead is responsible for posting slash commands at each gate; there is no multi-approver or role-based gate enforcement in the current implementation.
