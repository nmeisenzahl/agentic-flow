---

description: "Task list for 002-framework-remediation — five-area second-iteration remediation of the agentic-flow pipeline"
---

# Tasks: Agentic-Flow Framework Second-Iteration Remediation

**Feature**: `002-framework-remediation`  
**Input**: `specs/002-framework-remediation/plan.md` + `specs/002-framework-remediation/spec.md`  
**Validation**: speckit.analyze (consistency) → `claude-opus-4.6` + `gpt-5.4` technical review (Principle III) — both layers MUST PASS before human gate.

> **No tasks-output YAML sidecar** — per architectural decision A1 the post-merge AW reads
> `tasks.md` directly. The existing checklist format (`- [x] T001 [P] [US1] …`) is sufficient
> for the agent to extract task IDs, titles, and descriptions reliably. No format changes to
> this file are required beyond what this document already produces.

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel with other [P]-marked tasks (different files, no shared dependencies)
- **[US1–US5]**: User story this task belongs to (maps to priorities P1–P5 in spec.md)
- Setup and Polish phases carry no story label

---

## Phase 1: Setup

**Purpose**: Verify the one prerequisite that influences the US3 implementation strategy before
any source files are touched.

- [ ] T001 Run composite-action path-resolution spike — compile a minimal test AW that references `./.github/actions/assign-pr-agent` with `gh aw compile --actionlint`; if the `src/.github/actions/` path resolves correctly proceed to T006; if not, evaluate hosting the action under `.github/actions/` instead and update the composite-action path in T006–T009 accordingly

**Checkpoint**: Spike result confirmed → composite action target path is known → US3 (Phase 5) can begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No tasks block all five user stories simultaneously. Architectural decisions A1, A2,
and A3 are already finalised in plan.md. T001 (above) is the only prerequisite that blocks a
subset of work (US3). Proceed directly to user story phases.

**⚠️ NOTE**: US2 (Phase 4) is fully independent and can be merged before any other user story.
US1 (Phase 3) and US3 (Phase 5) can be worked in parallel by different contributors once T001
is confirmed.

---

## Phase 3: User Story 1 — Reliable Post-Merge Sub-Issue Creation (Priority: P1) 🎯 MVP

**Goal**: Replace the broken `post-merge.yml` JavaScript workflow with an Agentic Workflow that
reads `tasks.md` directly and creates one labelled GitHub sub-issue per task via MCP tools,
with idempotency and visible partial-failure reporting.

**Independent Test**: Merge a feature branch that has a completed tasks stage output;
trigger post-merge manually (`workflow_dispatch`); verify one GitHub sub-issue is created for
each task in `tasks.md` — correctly titled, labelled `agentic-flow-task`, linked to the parent
feature issue — with zero manual intervention and no duplicate sub-issues on rerun.

### Implementation for User Story 1

- [x] T002 [US1] Create `src/.github/workflows/post-merge-trigger.yml` — standard GHA workflow triggering on `pull_request: closed`; guard: `merged == true && labels contains ready-to-merge`; extract `feature_issue_number`, `spec_directory`, and `pr_number` from PR context block (mirror `research-trigger.yml` structure); run `gh label create --force agentic-flow-task` before dispatching; dispatch `post-merge.lock.yml` via `workflow_dispatch` with the three inputs
- [x] T003 [US1] Create `src/.github/workflows/post-merge.md` — AW with `workflow_dispatch` trigger; agent behaviour: (1) read `{spec_directory}/tasks.md` — post error comment to feature issue and stop if absent; (2) extract task list (ID, title, description) from checklist format; (3) call `issue_read(get_sub_issues)` on `feature_issue_number` to get existing sub-issues for idempotency; (4) for each task whose title is NOT already present: create issue via `issue_write(create)` with `agentic-flow-task` label, then link as sub-issue via `sub_issue_write(add)` using the integer `id` from the create response (not issue number); (5) after batch: post Task Sub-Issue Summary comment to feature issue listing per-task ✅/❌ status; (6) on partial failure: surface which tasks succeeded and which failed rather than failing silently; (7) paginate through all spec PR comments when searching for context block — no fixed page cap; (8) after writing this file, run `gh aw compile src/.github/workflows/post-merge.md` to generate `post-merge.lock.yml` and commit both — the trigger in T002 dispatches the compiled lock file; the .md source is not executed directly; **FR-004 verified**: the `agentic-flow-tasks` and `agentic-flow-spec` wrapper definitions already produce tasks.md in the checklist format consumed by steps (2)–(4) above — no wrapper changes required
- [x] T004 [US1] Delete `src/.github/workflows/post-merge.yml` — replaced entirely by T002 trigger shim + T003 AW; verify no other workflow file references `post-merge.yml` before removal

**Checkpoint**: Post-merge AW functional — US1 acceptance scenarios SC-001 and SC-008 met

---

## Phase 4: User Story 2 — Successful Tagged Release (Priority: P2)

**Goal**: Remove the forbidden dev-only file that causes the release workflow's pre-flight
validation to abort before packaging begins, allowing tagged releases to complete from a clean
checkout without manual intervention.

**Independent Test**: Push a test tag from a clean checkout; observe the release workflow
completing end-to-end with no manual intervention; confirm pre-flight validation passes.

### Implementation for User Story 2

- [ ] T005 [P] [US2] Delete `.github/copilot-instructions.md` — dev-only VS Code/Copilot local hints file forbidden by `release.yml` pre-flight validation (line: `forbidden=(".github/copilot-instructions.md")`); runtime agent instructions live in `src/.github/copilot/instructions.md` and are unaffected; verify locally after deletion: `forbidden=(".github/copilot-instructions.md"); for f in "${forbidden[@]}"; do [ ! -f "$f" ] || { echo "FORBIDDEN: $f"; exit 1; }; done && echo "OK"`

**Checkpoint**: Pre-flight validation passes locally → release workflow unblocked → SC-002 met

---

## Phase 5: User Story 3 — Single Authoritative Source for Shared Workflow Logic (Priority: P3)

**Goal**: Extract the ~330-line PR-assignment workaround block (duplicated verbatim in `plan.md`,
`refine.md`, `tasks.md`) into a single composite GitHub Action so that a change to the shared
logic requires editing exactly one file.

**Independent Test**: Update a parameter in the composite action; run all three pipeline stages
that use it (`plan`, `refine`, `tasks`); verify all three reflect the change without edits to
any individual stage file.

**Dependency**: T001 must be confirmed before T006 begins.

### Implementation for User Story 3

- [x] T006 [US3] Create `src/.github/actions/assign-pr-agent/action.yml` — composite action with inputs: `stage-name` (plan|refine|tasks), `agent-name`, `pull-number`, `feature-issue-number`, `spec-directory`, `agent-token`, `speckit-phase-agent`, `primary-artefact`; output: `startup-comment-id`; centralises: staged-mode early exit (`GH_AW_SAFE_OUTPUTS_STAGED`), `GH_AW_AGENT_TOKEN` presence check, `GH_AW_AGENT_OUTPUT` file read + JSON parse, `assign_{stage}_agent_workaround` item filter and count guard, PR number match guard, GraphQL query for Copilot assignee ID, `waitForCopilotAssignment` + `waitForCopilotUnassignment` polling loops, startup comment body (parameterised by stage-name and agent-name), `addAssignees` → post-comment → `removeAssignees` sequence; path: release zip strips `src/` prefix so action lands at `.github/actions/assign-pr-agent/action.yml` in consumer repos — use `uses: ./.github/actions/assign-pr-agent`
- [x] T007 [US3] Update `src/.github/workflows/plan.md` — replace the ~330-line inline `assign-plan-agent-workaround` block with a single composite action call (`uses: ./.github/actions/assign-pr-agent` with `stage-name: plan`); simultaneously apply A3 conditional error routing: post to spec PR (slash command on PR context) instead of Feature Issue; use `create_issue_comment` with PR number — never `create_pull_request_review_comment`; **also satisfies US4/A3**: the A3 error-routing fix and composite-action refactor are applied atomically in a single commit
- [x] T008 [US3] Update `src/.github/workflows/refine.md` — replace the ~330-line inline `assign-refine-agent-workaround` block with composite action call (`stage-name: refine`); apply A3 conditional error routing: post to spec PR; **also satisfies US4/A3**: error-routing fix and composite-action refactor are applied atomically in a single commit
- [x] T009 [US3] Update `src/.github/workflows/tasks.md` — replace the ~330-line inline `assign-tasks-agent-workaround` block with composite action call (`stage-name: tasks`); apply A3 conditional error routing: post to spec PR; this change is **atomic** — the error-routing fix (US4/A3) and composite-action refactor (US3/A2) MUST land in a single commit to this file; **also satisfies US4/A3**
- [x] T010 [P] [US3] Delete `src/.github/workflow-templates/` — dead code; the three files (`error-handler.md`, `phase-guard.md`, `mcp-github.yml`) are not imported by any AW (imports fail at runtime with "failed to download import file"); every workflow has its own inline equivalents; `git rm -r src/.github/workflow-templates/`

**Checkpoint**: PR-reassignment logic exists in exactly one file (action.yml) — SC-003 met; US3 acceptance scenarios satisfied

---

## Phase 6: User Story 4 — Correct Pipeline Step Sequencing and Contextual Comments (Priority: P4)

**Goal**: Fix the dangling "Step 6" reference in triage, apply A3 conditional error routing to
`spec.md` (the one stage whose error section is not absorbed by P3 edits), and audit all
pipeline stage definitions for any remaining dangling step references.

**Independent Test**: Run through the triage stage; verify every step reference in the output
points to an existing step. Trigger a post-merge run; verify the summary comment posts to the
feature issue. Trigger an error in a spec/plan/refine/tasks stage; verify the error comment
posts to the spec PR, not the feature issue.

**Note**: Error section fixes for `plan.md`, `refine.md`, and `tasks.md` are absorbed into T007,
T008, and T009 respectively. Post-merge summary comment correctness is built into T003.

### Implementation for User Story 4

- [x] T011 [P] [US4] Fix `src/.github/workflows/triage.md` Step 5 body — change `"the one applied in Step 6"` → `"the one applied in Step 4"` (R3: Step 4 is "Apply Label and Dispatch Research"; Step 6 does not exist); verify all five steps in triage.md are cross-referenced correctly after the fix
- [x] T012 [P] [US4] Fix `src/.github/workflows/spec.md` inline error section — apply A3 conditional error routing: agents triggered by slash command on a spec PR post error comment to the spec PR number; agents triggered from a feature issue post to the feature issue; use `create_issue_comment` with the appropriate target number (never `create_pull_request_review_comment`)
- [x] T013 [US4] Audit and fix all remaining dangling step references — read `triage.md`, `research.md`, `spec.md`, `plan.md` (post-T007), `refine.md` (post-T008), `tasks.md` (post-T009) and verify every step reference within each file points to a step defined in that same file; for each finding beyond the known T011 fix: apply the correction inline and document it in the commit body; deliverable: zero remaining dangling step references across all pipeline stage files in a single bounded pass; **depends on T007, T008, T009, T011, T012**

**Checkpoint**: Zero dangling step references in any pipeline stage — SC-004 met; error comments route to correct targets — SC-007 met

---

## Phase 7: User Story 5 — Accurate, Internally Consistent Documentation (Priority: P5)

**Goal**: Reconcile the dogfooding contradiction across `docs/contributing.md` and `AGENTS.md`;
replace the four ghost agent names in the constitution with actual operational agents; align
ownership attribution; mark unimplemented constitution promises as aspirational.

**Independent Test**: A new contributor reads only the documentation and can accurately state:
(a) dogfooding is a planned future capability, not currently active; (b) the agent names listed
are operational and locatable in the repo; (c) ownership is attributed consistently; (d) any
capability not yet implemented is explicitly labelled aspirational.

**Sequencing note**: This phase can be implemented and its changes committed independently. Full
verification of acceptance scenarios depends on US1–US4 remediation being observable, since
documentation must reflect the post-remediation state. Deliver this phase after US1–US4 land.

### Implementation for User Story 5

- [x] T014 [P] [US5] Update `docs/contributing.md` — fix dogfooding claim (R7): change present-tense active statement ("All new features to agentic-flow are built using the agentic-flow pipeline itself") to match AGENTS.md accurate framing (dogfooding is a planned future capability; speckit slash commands are used locally for the speckit artifact pipeline only)
- [ ] T015 [US5] **Absorbed into T018** — AGENTS.md Dogfooding cross-reference and accuracy check is now part of T018's sweep; no separate deliverable required
- [x] T016 [US5] Update `.specify/memory/constitution.md` Agent Roster — remove ghost agents (`speckit-driver`, `feature-researcher`, `feature-implementer`, `review-orchestrator` — none exist in `.github/agents/` or `src/.github/agents/`); replace with actual operational agents: speckit agents (`.github/agents/`: `speckit.specify`, `speckit.clarify`, `speckit.plan`, `speckit.tasks`, `speckit.analyze`, `speckit.checklist`, `speckit.implement`, `speckit.constitution`, `speckit.taskstoissues`, `agentic-workflows`) and runtime wrapper agents (`src/.github/agents/`: `agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`); mark any planned-but-not-yet-created agents explicitly as aspirational
- [x] T017 [US5] Update `.specify/memory/constitution.md` validation promises — change Principle VII `⚠️ NOTE` → `❌ FAIL (documented exception)` with explanation (no automated test harness; manual end-to-end substitutes; adding a harness is a separate feature); identify all other present-tense capability claims that describe unimplemented functionality and mark each with `*[aspiration — not yet automated]*`
- [x] T018 [US5] Run grep sweep across `docs/`, `AGENTS.md`, and root `*.md` for stale agent names (`feature-researcher`, `speckit-driver`, `review-orchestrator`, `feature-implementer`) and stale ownership/repository attribution; fix all hits found — correct agent name or remove stale reference, align ownership attribution to single consistent entity; **also absorbs T015**: while in `AGENTS.md`, add cross-reference from the Dogfooding section to `docs/contributing.md` and confirm the "planned future capability" framing is accurate and consistent post-remediation

**Checkpoint**: Zero ghost agent names in documentation, zero dogfooding contradictions, zero present-tense unimplemented claims — SC-005 and SC-006 met

---

## Final Phase: Polish & End-to-End Verification

**Purpose**: Smoke-test the full remediated pipeline and confirm all eight success criteria are met.

- [ ] T019 Run post-merge AW smoke test — merge a test branch with a valid `tasks.md` in the spec directory; confirm `post-merge-trigger.yml` fires, AW creates one sub-issue per task labelled `agentic-flow-task`, feature issue updated with sub-issue links and Task Sub-Issue Summary comment; rerun AW and confirm zero duplicate sub-issues (SC-001, SC-008)
- [ ] T020 Run release workflow smoke test — push a version tag from a clean checkout; confirm pre-flight validation passes with `.github/copilot-instructions.md` absent; confirm release workflow completes end-to-end without manual intervention (SC-002)
- [ ] T021 Verify all eight success criteria — read SC-001 through SC-008 against post-remediation source files and manual test results; document the verification outcome for each criterion; flag any unmet criterion for immediate resolution before merge

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (T001 spike)          — no dependencies; run immediately
  ↓ confirms composite action path
Phase 5 (US3: T006–T010)      — depends on T001 result
  ↓ composite action exists
  Phase 5 tasks T007, T008, T009 — each depends on T006

Phase 3 (US1: T002–T004)      — independent of T001; run in parallel with Phase 4 + Phase 5
Phase 4 (US2: T005)           — fully independent; can be merged before all others
Phase 6 (US4: T011–T013)      — T011 and T012 are independent; T013 depends on T007/T008/T009, T011, T012

Phase 7 (US5: T014–T018)      — can be implemented in parallel; full verification only after Phase 3–6 complete
Final (T019–T021)             — depends on all previous phases complete
```

### User Story Dependencies

- **US1 (P1)**: Independent — begins immediately after architectural decisions (already finalised)
- **US2 (P2)**: Independent — can be merged before all other stories
- **US3 (P3)**: Depends on T001 spike result; T007/T008/T009 depend on T006
- **US4 (P4)**: T011/T012 independent; T013 depends on T007/T008/T009 (reads post-P3 files) and T011/T012 (consolidates all step-reference fixes in one pass)
- **US5 (P5)**: Can be implemented in parallel; verification depends on US1–US4 landing

### Critical Atomic Constraint

**T009 is atomic with A3 error-routing and A2 composite-action changes** to `src/.github/workflows/tasks.md` — US4 (error routing) and US3 (composite action refactor) MUST land in a single commit to this file. Do not split into separate PRs.

### Parallel Opportunities

- T005 (US2) is fully independent — merge as a standalone PR first
- T002, T003, T004 (US1) can progress in parallel with T001 (spike)
- T011, T012 (US4 step/error fixes) are independent of all other work
- T014 (US5 dogfooding fix) is independent of all other work; T015 is absorbed into T018
- T019 then T020 (smoke tests) must run sequentially — they share live repository state (labels, workflow triggers, release packaging)

---

## Parallel Example: User Story 1

```bash
# All US1 tasks can run sequentially in one PR:
Task T002: "Create src/.github/workflows/post-merge-trigger.yml"
Task T003: "Create src/.github/workflows/post-merge.md"
Task T004: "Delete src/.github/workflows/post-merge.yml"
```

## Parallel Example: User Story 3

```bash
# After T006 (composite action) is merged:
Task T007: "Update src/.github/workflows/plan.md"   # independent files → run in parallel
Task T008: "Update src/.github/workflows/refine.md" # independent files → run in parallel
Task T009: "Update src/.github/workflows/tasks.md"  # independent files → run in parallel
Task T010: "Delete src/.github/workflow-templates/" # fully independent
```

---

## Implementation Strategy

### MVP First (US1 + US2 — the two unblocking fixes)

1. Complete T001 (spike) — 15 min
2. Complete Phase 4 (T005 only) → **merge independently** — release workflow unblocked
3. Complete Phase 3 (T002–T004) → **merge** — post-merge pipeline closes its loop
4. **STOP and VALIDATE**: Confirm SC-001 and SC-002 met before proceeding

### Incremental Delivery

1. T005 → merge → US2 done (release unblocked, zero risk)
2. T002–T004 → merge → US1 done (post-merge AW operational)
3. T001 → T006 → T007/T008/T009/T010 → merge → US3 done (duplication eliminated)
4. T011/T012/T013 → merge → US4 done (step refs + error routing correct)
5. T014–T018 → merge → US5 done (documentation accurate)
6. T019–T021 → final verification pass

### Parallel Team Strategy

With two contributors:

1. Both complete T001 together (< 1 hour)
2. **Contributor A**: T005 (US2) then T002–T004 (US1)  
   **Contributor B**: T006–T010 (US3) then T011–T013 (US4)
3. After both tracks land: T014–T018 (US5) together
4. T019–T021 final verification

---

## Notes

- [P] tasks touch different files with no in-flight dependencies — safe to run concurrently
- [US1–US5] label maps each task to its user story for traceability to spec.md
- US2 (T005) is a single-file deletion — lowest risk, highest return; merge it first
- T009 is the only task with a hard atomicity constraint (US3/A2 composite-action refactor + US4/A3 error-routing fix in the same file, applied in one commit)
- No automated test harness exists; all verification is manual end-to-end (Principle VII documented exception per constitution update T017)
- Commit each phase as a logical unit; prefer one PR per user story
- Use Conventional Commits format: `fix(post-merge): …`, `fix(release): …`, `refactor(shared): …`, `fix(triage): …`, `docs(constitution): …`
