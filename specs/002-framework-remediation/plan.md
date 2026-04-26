# Implementation Plan: Agentic-Flow Framework Second-Iteration Remediation

**Branch**: `002-framework-remediation` | **Date**: 2025-07-22 | **Spec**: [spec.md](https://github.com/nmeisenzahl/agentic-flow/blob/cd2cc771edac182164443f03ba728f598b8871b9/specs/002-framework-remediation/spec.md)  
**Input**: Feature specification from `/specs/002-framework-remediation/spec.md`

---

## ⚠️ Architectural Decisions — Read Before Implementing

These three decisions MUST be agreed upon before any implementation task begins. All tasks in
Phase 1 (P1) and Phase 3 (P3) are blocked by decisions A1 and A2 respectively.

### A1 — Post-Merge Stage Architecture (blocks P1 implementation)

**Decision: Agentic Workflow (`post-merge.md`) with standard GHA trigger shim.**

The existing `post-merge.yml` JavaScript workflow is replaced by two files, following the same
pattern already used by research (`research-trigger.yml` → `research.md`):

| File | Purpose | Type |
|------|---------|------|
| `src/.github/workflows/post-merge-trigger.yml` | Fires on `pull_request: closed`; guards on `merged == true && ready-to-merge` label; extracts feature issue number + spec directory; dispatches `post-merge.lock.yml` via `workflow_dispatch` | Standard GHA YAML |
| `src/.github/workflows/post-merge.md` | AW agent: reads `tasks.md`, creates one labelled sub-issue per task via MCP GitHub tools, handles idempotency, posts summary comment | Agentic Workflow |

**Why AW over the existing JavaScript workflow:**

| Option | Decision | Reason |
|--------|----------|--------|
| **AW (`post-merge.md`)** | ✅ **CHOSEN** | Consistent with all other pipeline stages; agent reads `tasks.md` naturally without a separate machine-readable sidecar; MCP tools handle pagination, label upsert, and idempotency checks natively; no JS maintenance burden |
| YAML sidecar + JS | ❌ Rejected | Tasks agent must produce well-formed YAML (another failure point); the JS parser is what caused the current bug; adds schema maintenance overhead; inconsistent with the rest of the pipeline which is entirely AW-based |

**Trigger shim pattern** (mirrors `research-trigger.yml`):  
The shim fires on the native GHA event, does minimal logic (merged + label guard, context
extraction), then dispatches the AW via `workflow_dispatch` with feature issue number and spec
directory as inputs. The AW does not need to inspect the PR itself.

**Idempotency**: The agent calls `issue_read` (`get_sub_issues` method) on the feature issue to
get the current list of sub-issues. If a sub-issue with the same title already exists, creation
is skipped. This provides reliable duplicate prevention across partial-failure reruns.

> **Note**: `list_issues` does NOT support filtering by parent issue — it only filters by label,
> state, and date. Using it for idempotency would return all `agentic-flow-task`-labelled issues
> across the entire repo, making title-matching unreliable. `issue_read(get_sub_issues)` returns
> only sub-issues of the specific parent feature issue and is the correct approach.

**`tasks.md` format**: The AW reads `tasks.md` directly. The existing checklist format
(`- [ ] T001 [P] [US1] Title — Description`) is parseable by the agent. No format changes to
`tasks.md` are required; the format is already structured enough for an LLM to extract task IDs,
titles, and descriptions reliably.

> **Note (L1)**: `post-merge.md` must be compiled to `post-merge.lock.yml` via `gh aw compile`
> before the trigger shim can dispatch it. Follow the same compile-verify pattern used for all
> other AWs (see *Edit/Compile Cycle* in `AGENTS.md`). Lock files are gitignored in this dev repo;
> each adopting project compiles and commits its own.

---

### A2 — Shared Code Extraction Strategy (blocks P3 implementation)

**Decision: Reusable composite GitHub Action.**

**Verification result**: `gh aw` v0.67.1 parses `imports:` front-matter without a syntax error
but resolves import paths by attempting a remote download. Local filesystem paths (e.g.,
`src/.github/workflow-templates/error-handler.md`) fail with:

```
error: failed to download import file
```

This confirms that template imports are **not usable for local-file extraction** in the current
compiler version. The `workflow-templates/` directory was designed for this purpose but the
compiler does not support it for local repositories.

**Chosen extraction target**: `src/.github/actions/assign-pr-agent/action.yml`

> **Why this action exists**: `gh aw`'s built-in `assign_to_agent` path for PR targets is unreliable — it fails to consistently trigger the Copilot agent on the spec PR. This action encapsulates the manual workaround: forcibly assign Copilot via the GitHub API, post a startup comment, then remove the assignment after the agent picks up the task. Once `gh aw` fixes its built-in PR assignment, this action can be replaced with the native step.

**Path resolution note**: The release zip strips the `src/` prefix, so the action lands at
`.github/actions/assign-pr-agent/action.yml` in the **user's repository**. The
reference `uses: ./.github/actions/assign-pr-agent` is therefore correct for compiled
workflow runs in user repos. In this development repo the action lives under `src/`, so local
`gh aw compile --actionlint` may fail to resolve the path — the T001 spike must verify this
before committing the extraction (see spike note in Implementation Order).

The ~330-line PR-assignment workaround block (identical logic in `plan.md`, `refine.md`,
`tasks.md` modulo `{stage}` name substitution) becomes a composite action with stage-specific
inputs. Each workflow calls it as:

```yaml
- name: Run PR assignment workaround
  uses: ./.github/actions/assign-pr-agent
  with:
    stage-name: plan                    # or refine / tasks
    agent-name: agentic-flow-plan       # or agentic-flow-spec / agentic-flow-tasks
    pull-number: ${{ ... }}
    feature-issue-number: ${{ ... }}
    spec-directory: ${{ ... }}
    agent-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
    speckit-phase-agent: .github/agents/speckit.plan.agent.md
    primary-artefact: ${{ specDirectory }}/plan.md
```

The composite action centralises:
- Staged-mode early exit (`GH_AW_SAFE_OUTPUTS_STAGED`)
- GH_AW_AGENT_TOKEN presence check
- GH_AW_AGENT_OUTPUT file read + JSON parse
- `assign_{stage}_agent_workaround` item filter and count guard
- PR number match guard
- GraphQL query for Copilot assignee ID
- `waitForCopilotAssignment` + `waitForCopilotUnassignment` polling loops
- Startup comment body generation (parameterised by stage name and agent name)
- `addAssignees` → post-comment → `removeAssignees` sequence

Items that differ per stage (startup comment text body, agent file name, safe-output type name)
are inputs to the composite action.

**`workflow-templates/` is dead code**: The directory and its three files (`error-handler.md`, `phase-guard.md`, `mcp-github.yml`) are not imported by any AW — every workflow has its own inline equivalents. The directory is **deleted in this remediation (T010)**: `git rm -r src/.github/workflow-templates/`.

---

### A3 — Error Handler Target (blocks P4 implementation)

**Decision: Post error notifications conditionally based on pipeline phase.**

`error-handler.md` currently instructs agents to post to "the Feature Issue" using
`create_issue_comment`. Per FR-009 and US4-AC3, errors during pipeline stages that have an
associated spec PR MUST be posted to the spec PR. However, triage and research stages run
**before** a spec PR exists — unconditionally redirecting to the spec PR would break error
reporting for these early stages.

**Conditional routing rule**:

| Stage | Context | Error target |
|-------|---------|--------------|
| triage, research | No spec PR exists yet | Feature Issue |
| spec, plan, refine, tasks, post-merge | Agent is running on the spec PR | Spec PR |

**Updated instruction in `error-handler.md`:**

> **Note (M1)**: `error-handler.md` is deleted by T010 (dead code; not imported by any AW). The A3
> conditional routing rule is applied **inline** to each AW's own error section during T007, T008,
> T009, and T012. No update to the `error-handler.md` file is required or possible.

```markdown
On any failure during agent execution, post a human-readable recovery comment using the
GitHub MCP `create_issue_comment` tool:

- If you were invoked by a slash command running on a spec PR (i.e. your trigger is a
  `slash_command` event on a pull request — stages spec, plan, refine, tasks, post-merge),
  post to the current pull request number.
- Otherwise (triage and research stages, triggered from a feature issue), post to the
  Feature Issue number.
```

**No context block change required**: The PR number is available from the slash-command
trigger context (`github.event.pull_request.number`). Verified: NO `Spec PR: #N` field exists
in any current context block — all blocks contain only `Feature issue: #N` plus stage-specific
fields. Adding a new context block field is therefore unnecessary; the trigger type (issue vs PR)
is the reliable discriminator.

> ⚠️ Do NOT use `create_pull_request_review_comment` — that tool creates inline code-review
> comments requiring `diff_hunk`, `path`, and `position` parameters and is not usable for
> general error notifications. Always use `create_issue_comment` with the appropriate issue/PR
> number.

---

## Summary

Five categories of defects in the agentic-flow framework's first iteration prevent reliable
production use. This plan remediates all five in dependency order:

1. **P1 — Post-merge AW** (US1): Replace `post-merge.yml` JS workflow with `post-merge.md` AW +
   `post-merge-trigger.yml` shim; agent reads `tasks.md` directly, creates sub-issues via MCP,
   handles idempotency via `issue_read(get_sub_issues)`.

2. **P2 — Release blocker** (US2): Delete the forbidden `.github/copilot-instructions.md`
   file from the dev-only `.github/` tree; verify release workflow passes.

3. **P3 — Shared code** (US3): Extract the ~330-line PR-assignment workaround into a composite
   GitHub Action; update plan.md, refine.md, and tasks.md to call it.

4. **P4 — Workflow correctness** (US4): Fix triage Step 5's dangling "Step 6" reference;
   update inline error sections in spec/plan/refine/tasks AWs to post to spec PR instead of
   Feature Issue.

5. **P5 — Documentation accuracy** (US5): Reconcile dogfooding contradiction across
   `docs/contributing.md` and `AGENTS.md`; correct four ghost agent names in constitution;
   align ownership attribution; mark unimplemented constitution promises as aspirational.

---

## Technical Context

**Language/Version**: Bash (GHA shell steps), YAML, Markdown (AW sources)  
**Primary Dependencies**: `gh aw` v0.67.1, MCP GitHub tools, GitHub GraphQL API  
**Storage**: Git-tracked files (agentic workflow `.md` sources, composite action `action.yml`)  
**Testing**: Manual end-to-end (trigger post-merge on merged branch; push test tag; run pipeline stages); no automated test harness exists yet  
**Target Platform**: GitHub Actions (ubuntu-latest runners), GitHub Copilot agent runtime  
**Performance Goals**: N/A — correctness and reliability, not throughput  
**Constraints**: Must remain compatible with `gh aw` v0.67.1; no new secrets beyond `GH_AW_AGENT_TOKEN`; composite action must work from `./.github/actions/` path  
**Scale/Scope**: Five remediation areas; ~6 source files modified; 1 composite action created; 2 documentation files corrected  

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Rechecked after Phase 1 design.*

| Principle | Verdict | Justification |
|-----------|---------|---------------|
| **I — Spec-First** | ✅ PASS | `spec.md` is merged; `plan.md` follows; `tasks.md` will follow plan approval. No code change precedes spec. |
| **II — Append-Only** | ✅ PASS | All source file edits are implementation file modifications, not issue/PR body overwrites. |
| **III — AI Pre-Review** | ✅ PASS | Plan artifact passes `speckit.analyze` before human gate; multi-model validation (claude-opus-4.6 + gpt-5.4) runs after. |
| **IV — Dog Food** | ✅ PASS | This remediation goes through the full pipeline (triage → spec → plan → tasks → implementation → review → merge). |
| **V — Exactly Four Gates** | ✅ PASS | No additional blocking gates introduced. |
| **VI — Traceability** | ✅ PASS | Spec referenced via merge-commit SHA blob URL above. Commits will follow Conventional Commits format. |
| **VII — Test Coverage Floor** | ❌ FAIL (documented exception) | No automated test suite exists at this stage. Constitution's 90% floor is aspirational per P5 remediation (FR-017). The constitution will be updated to mark this as a target. Manual end-to-end verification substitutes until an automated harness is introduced. |

**Complexity Tracking** (Principle VII caveat):

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No automated test harness (< 90% floor) | Framework has no existing test infrastructure; adding one is a separate feature | Adding a test harness within this remediation scope would more than double the implementation surface and delay the P1–P4 fixes that directly unblock production use |

---

## Project Structure

### Documentation (this feature)

```text
specs/002-framework-remediation/
├── spec.md              # Input — approved spec (SHA cd2cc77)
├── plan.md              # This file (Phase 0 research embedded below)
└── tasks.md             # Phase 2 output (/speckit.tasks command — NOT created here)
```

### Source Files Modified/Created

```text
# P1 — Post-merge AW (replaces JS workflow)
src/.github/workflows/post-merge-trigger.yml          # CREATE — trigger shim (pull_request: closed → dispatch AW)
src/.github/workflows/post-merge.md                   # CREATE — AW agent: reads tasks.md, creates sub-issues via MCP
src/.github/workflows/post-merge.yml                  # DELETE — replaced by AW approach
src/.github/workflows/tasks.md                        # Replace inline workaround → composite action call (same file as P3)

# P2 — Release blocker
.github/copilot-instructions.md                      # DELETE (forbidden file)

# P3 — Shared code extraction
src/.github/actions/assign-pr-agent/        # CREATE (composite action)
  action.yml
src/.github/workflows/plan.md                        # Replace inline workaround → composite action call + A3 error routing
src/.github/workflows/refine.md                      # Replace inline workaround → composite action call + A3 error routing
src/.github/workflows/tasks.md                       # Replace inline workaround → composite action call + A3 error routing (same file as P1)
src/.github/workflow-templates/                      # DELETE — dead code (T010; not imported by any AW)

# P4 — Workflow correctness
src/.github/workflows/triage.md                      # Fix Step 5 "Step 6" reference → "Step 4"
src/.github/workflows/spec.md                         # Fix inline error section: target spec PR instead of Feature Issue
src/.github/workflows/plan.md                         # Fix inline error section (absorbed into T007)
src/.github/workflows/refine.md                       # Fix inline error section (absorbed into T008)
src/.github/workflows/tasks.md                        # Fix inline error section (absorbed into T009)

# P5 — Documentation accuracy
docs/contributing.md                                 # Reconcile dogfooding statement
AGENTS.md                                            # Reconcile dogfooding statement
.specify/memory/constitution.md                      # Fix ghost agents + aspirational markers
```

---

## Phase 0: Research

*All NEEDS CLARIFICATION items resolved below. No items remain.*

### R1 — `gh aw` Import Resolution (resolves A2)

**Finding**: `gh aw` v0.67.1 parses `imports:` front-matter without syntax error but resolves
paths by attempting an HTTP download. Local filesystem paths fail with
`"failed to download import file"`. Verified empirically by compiling a minimal test workflow
with `imports: - src/.github/workflow-templates/error-handler.md`.

**Decision**: Composite GitHub Action (see A2 above).

**Alternative evaluated and rejected**: Bash helper script sourced from each workflow step.
Rejected because GitHub Actions composite actions provide cleaner input/output isolation,
versioning, and are the idiomatic GHA reuse pattern. A shell script approach would require
`source` invocations inside `github-script` (JavaScript) steps, which is not possible.

---

### R2 — Post-merge `tasks.md` Parse Architecture (resolves A1)

**Finding**: `post-merge.yml` currently uses `js-yaml@4.1.0` to parse a structured YAML sidecar
(`tasks-output.yaml`), but the tasks-stage AW only produces `tasks.md` (Markdown checklist).
This contract mismatch silently produces empty task lists or errors.

**Resolution (per A1 decision)**: The post-merge stage is replaced by an AW (`post-merge.md`)
that reads `tasks.md` directly via MCP file-access. No YAML sidecar is introduced. Idempotency
is achieved via `issue_read(get_sub_issues)` title-match. The existing `post-merge.yml` is deleted (T004).

---

### R3 — Triage Step Reference Defect (resolves P4 scope)

**Finding**: `triage.md` Step 5 body (line 117):

> "Do NOT apply any ADDITIONAL label beyond the one applied in Step 6, and do NOT fail."

Steps defined in `triage.md`: Steps 1, 2, 3, 4, 5. Step 6 does not exist.
Step 4 is where the label is applied ("Apply Label and Dispatch Research"). The reference
should be "Step 4".

---

### R4 — Error Handler Target (resolves A3)

**Finding**: `error-handler.md` instructs agents to post to "the Feature Issue" via
`create_issue_comment`. Posting errors to the spec PR is more actionable because reviewers are
already subscribed to that PR. However, early stages (triage, research) have no spec PR — so
routing must be conditional.

**Investigation**: No `Spec PR: #N` field exists in any `<!-- agentic-flow-context -->` block.
The PR number is available from the slash-command trigger (`github.event.pull_request.number`)
at workflow runtime. The reliable discriminator is the trigger type: stages triggered by slash
commands on PRs (spec, plan, refine, tasks) post to the PR; stages triggered by issue events
(triage, research) post to the feature issue.

**Approach**: Update `error-handler.md` with conditional routing based on trigger context.
No context block changes needed.

---

### R5 — Release Forbidden File (resolves P2 scope)

**Finding**: `release.yml` line `forbidden=(".github/copilot-instructions.md")` checks for and
rejects the file `.github/copilot-instructions.md` at the repository root. This file exists at
`/Users/nico/Projects/personal/agentic-flow/.github/copilot-instructions.md`.

This is a **dev-only VS Code / Copilot local hints file** that has no counterpart in the
shipped artifact. The runtime agent instructions live exclusively in
`src/.github/copilot/instructions.md`. The dev file is safe to delete.

**Verification**: After deletion, run `release.yml` pre-flight validation step locally:

```bash
forbidden=(".github/copilot-instructions.md")
for f in "${forbidden[@]}"; do
  [ ! -f "$f" ] || { echo "FORBIDDEN FILE EXISTS: $f"; exit 1; }
done
```

---

### R6 — Ghost Agents in Constitution (resolves P5 scope)

**Finding**: The constitution's Agent Roster lists four agents:
- `speckit-driver`
- `feature-researcher`
- `feature-implementer`
- `review-orchestrator`

None of these exist in `.github/agents/` or `src/.github/agents/`. The actual operational
agents are:

**Speckit agents** (`.github/agents/`):
- `speckit.specify`, `speckit.clarify`, `speckit.plan`, `speckit.tasks`, `speckit.analyze`,
  `speckit.checklist`, `speckit.implement`, `speckit.constitution`, `speckit.taskstoissues`,
  `agentic-workflows`

**Runtime wrapper agents** (`src/.github/agents/`):
- `agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`

**Fix**: Replace the ghost agent roster with the actual operational agents; mark planned
agents (such as a `feature-implementer` equivalent) as aspirational.

---

### R7 — Dogfooding Contradiction (resolves P5 scope)

**Finding**:

- `docs/contributing.md` line 9: *"All new features to agentic-flow are built using the
  agentic-flow pipeline itself."* (present tense, active)
- `AGENTS.md` "Dogfooding" section: *"Using the agentic-flow pipeline to develop the framework
  itself … is a **planned future capability**."*

These are direct contradictions. The `AGENTS.md` statement is more accurate: the pipeline
workflows run under `.github/` which GitHub Actions reads, but the source files live under
`src/.github/` — the framework does not currently run against itself as GitHub Actions.
`spec-kit` slash commands are used locally for the speckit artifact pipeline only.

**Fix**: `docs/contributing.md` updates the claim to match `AGENTS.md`'s accurate framing.

---

## Phase 1: Design

### Data Model

No new persistent data entities are introduced by this remediation. `tasks.md` is the sole
inter-stage artifact; the post-merge AW reads it directly — no sidecar format needed.

**State transitions** (post-merge stage, updated):

```
tasks stage runs
  → writes specs/{NNN}/tasks.md  (Markdown checklist — unchanged format)
  → commits to spec PR branch
post-merge AW runs (triggered via post-merge-trigger.yml on PR merge with ready-to-merge label)
  → reads specs/{NNN}/tasks.md from merged branch
  → extracts task list (ID, title, description, labels) via MCP file-access
  → calls `issue_read(get_sub_issues)` on feature issue to get existing sub-issues for idempotency
  → creates one GitHub Issue per new task (idempotent: skips existing by title)
  → links each issue as sub-issue to feature issue
  → posts Task Sub-Issue Summary comment to feature issue
```

### Interface Contracts

#### `post-merge.md` AW Contract (inputs from trigger shim)

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `feature_issue_number` | string | yes | Number of the feature issue (parent of sub-issues) |
| `spec_directory` | string | yes | Path to spec dir, e.g. `specs/002-framework-remediation` |
| `pr_number` | string | yes | Merged PR number (for context / error comment fallback) |

**Agent behaviour contract**:
1. Read `{spec_directory}/tasks.md` — if absent, post error comment to feature issue and stop
2. Extract tasks (ID, title, description) from checklist format
3. Call `issue_read(get_sub_issues)` on `feature_issue_number` — get existing sub-issues list
4. For each extracted task whose title is NOT already in the sub-issues list:
   a. Create issue via `issue_write(create)` with `title`, `body`, `labels: ['agentic-flow-task']`
   b. Link as sub-issue via `sub_issue_write(add)` using `sub_issue_id: <integer ID from create response>` (not issue number — the `id` field, not `number`)
5. After batch: post Task Sub-Issue Summary comment to feature issue (successes + any failures)

> **Label pre-condition**: The `agentic-flow-task` label must exist before step 4a runs — GitHub
> returns 422 if a label applied at issue-create time doesn't exist in the repo. The
> `post-merge-trigger.yml` shim handles this by running `gh label create --force agentic-flow-task`
> before dispatching the AW. This does not require MCP tools and avoids `labels` toolset dependency.

**Idempotency**: Title-based match against existing sub-issues returned by `issue_read(get_sub_issues)`. If a sub-issue with identical title already exists, skip creation. This is scoped to the specific parent feature issue — not a repo-wide label scan.

**Partial-batch failure surfacing**: Agent continues the loop after a failed create; records the failure; posts a partial-completion summary identifying which tasks succeeded and which failed.

#### Composite Action Contract (`src/.github/actions/assign-pr-agent/action.yml`)

```yaml
# inputs
inputs:
  stage-name:
    description: "Pipeline stage name (plan | refine | tasks)"
    required: true
  agent-name:
    description: "Agent file name without extension (agentic-flow-plan | agentic-flow-spec | agentic-flow-tasks)"
    required: true
  pull-number:
    description: "Spec PR number (string)"
    required: true
  feature-issue-number:
    description: "Feature issue number (string)"
    required: true
  spec-directory:
    description: "Spec directory path (e.g. specs/002-framework-remediation)"
    required: true
  agent-token:
    description: "GH_AW_AGENT_TOKEN PAT for Copilot agent assignment"
    required: true
  speckit-phase-agent:
    description: "Path to speckit phase agent file"
    required: true
  primary-artefact:
    description: "Primary artefact path (e.g. specs/NNN/plan.md)"
    required: true

# outputs
outputs:
  startup-comment-id:
    description: "GitHub comment ID of the posted startup comment"
```

---

## Implementation Order & Dependencies

```
P2 (release blocker) — independent: delete `.github/copilot-instructions.md`
P3 (shared code) — independent (after T001): delete `src/.github/workflow-templates/` (T010) + extract composite action (T006–T009)

P4a: triage.md step reference fix — independent
P4d: inline error section fix — coordinate spec.md independently (T012); absorbed into T007/T008/T009 for plan/refine/tasks (US3+US4 atomic)

P1 (post-merge AW) [A1 decided]
  T002: post-merge-trigger.yml — CREATE trigger shim (mirrors research-trigger.yml)
  T003: post-merge.md — CREATE AW (reads tasks.md, creates sub-issues via MCP, idempotency, summary)
  T004: post-merge.yml — DELETE (replaced by T002 + T003)

P3 (shared code extraction) [A2 decided]
  T006: create composite action action.yml
       ⚠️ Spike: verify gh aw compile --actionlint resolves src/.github/actions/ path;
          if not, evaluate alternative hosting under .github/actions/ instead
  T007: plan.md — replace inline block with composite action call + A3 error routing [US3+US4]
  T008: refine.md — replace inline block with composite action call + A3 error routing [US3+US4]
  T009: tasks.md — replace inline block with composite action call + A3 error routing [US3+US4] ← atomic single commit
  T010: DELETE src/.github/workflow-templates/ — dead code; runs independently (no file conflicts)

P5 (documentation) — depends on P1–P4 being complete (verification gate only)
  T014: docs/contributing.md — fix dogfooding statement
  T015: AGENTS.md — reconcile dogfooding statement
  T016: constitution.md — fix ghost agent roster (replace with actual operational agents)
  T017: constitution.md — mark aspirational promises; Principle VII → FAIL (documented exception)
  T018: grep sweep for stale ownership/agent references in docs/, AGENTS.md, root *.md
        (files: docs/README.md, docs/init.md, docs/usage.md + any hit from grep)
```

**Parallel opportunities**:
- P2 is fully independent and can be merged first.
- T011 (triage fix) can merge independently.
- T012 (inline error section fix, spec.md only) is independent; plan/refine/tasks error routing absorbed into T007/T008/T009.
- T014/T015/T016/T017/T018 (US5 docs) can be done in a single PR.
- T009 is the only task with a hard atomicity constraint — US4 error routing + US3 composite action refactor MUST land in a single commit to `tasks.md`.

---

## Quickstart for Implementors

### P1 — Post-merge AW

1. **Create `src/.github/workflows/post-merge-trigger.yml`**: Standard GHA workflow triggering
   on `pull_request: closed` with `merged == true && ready-to-merge` guard. Extracts
   `feature_issue_number`, `spec_directory`, and `pr_number` from PR context block (same
   logic as existing `meta` step in `post-merge.yml`). Dispatches `post-merge.lock.yml` via
   `workflow_dispatch` with these three inputs. Mirror `research-trigger.yml` structure.

2. **Create `src/.github/workflows/post-merge.md`**: AW with `workflow_dispatch` trigger.
   Agent steps:
   - Verify `tasks.md` exists at `{spec_directory}/tasks.md`; post error to feature issue if absent
   - Read and parse task list from `tasks.md`
   - Ensure `agentic-flow-task` label exists in repo (create if absent)
   - Call `issue_read(get_sub_issues)` on `feature_issue_number` to get existing sub-issues (idempotency)
   - For each task not already present (title match): create sub-issue with `agentic-flow-task` label
   - Post Task Sub-Issue Summary comment to feature issue (all tasks, ✅/❌ per-task status)

3. **Delete `src/.github/workflows/post-merge.yml`**: Replaced by trigger shim + AW above.

### P2 — Release blocker

```bash
git rm .github/copilot-instructions.md
git commit -m "fix(release): remove forbidden .github/copilot-instructions.md (#N)"
```

Verify locally:
```bash
forbidden=(".github/copilot-instructions.md")
for f in "${forbidden[@]}"; do [ ! -f "$f" ] || { echo "FORBIDDEN: $f"; exit 1; }; done && echo "OK"
```

### P3 — Composite action extraction

1. Create `src/.github/actions/assign-pr-agent/action.yml` with the shared logic
   parameterised on `stage-name`, `agent-name`, `pull-number`, `feature-issue-number`,
   `spec-directory`, `agent-token`, `speckit-phase-agent`, `primary-artefact`.

2. In `plan.md`, `refine.md`, `tasks.md`: replace the `assign-{stage}-agent-workaround` job's
   inline script (~330 lines) with a single composite action call.

3. Stage-specific substitutions that become inputs: `{stage}` in log messages and type names,
   startup comment body text, agent file name reference.

### P4 — Workflow correctness

- `triage.md` line 117: change `"the one applied in Step 6"` → `"the one applied in Step 4"`
- Inline error sections in `spec.md` (and absorbed into T007/T008/T009 for plan/refine/tasks):
  apply conditional routing (A3 above) — post to spec PR for pipeline stages that have one;
  post to Feature Issue for triage/research.
- `spec.md`, `plan.md`, `refine.md`, `tasks.md` context blocks: NO change needed — error handler
  uses trigger type (slash command on PR vs issue) to determine target, not a context block field.

> Note: post-merge heading / summary now live in the `post-merge.md` AW (T003). `post-merge.yml`
> is deleted entirely (T004). No P4 changes needed for it.

### P5 — Documentation accuracy

- `docs/contributing.md`: fix dogfooding claim (see R7 fix).
- `AGENTS.md` "Dogfooding" section: already accurate; add cross-reference to contributing.md.
- `constitution.md` Agent Roster: replace ghost agents with actual operational agents (see R6).
- `constitution.md` Principle VII: change `⚠️ NOTE` → `❌ FAIL (documented exception)`;
  mark other present-tense aspirational claims with `*[aspiration — not yet automated]*`.
- **T018 grep sweep**: Run explicit grep across `docs/`, `AGENTS.md`, and root `*.md` for:
  - stale agent names (`feature-researcher`, `speckit-driver`, `review-orchestrator`, etc.)
  - stale ownership/repository references
  Fix all hits found.
