# Implementation Checklist: Agentic-Flow Framework Second-Iteration Remediation

**Purpose**: Validate that architectural decisions, plan requirements, and tasks are sufficiently
specified, traceable, and unambiguous for safe implementation — covering pre-implementation
readiness, PR-review traceability, and post-implementation merge-gate completeness.  
**Created**: 2025-07-23  
**Feature**: [spec.md](../spec.md)  
**Audience**: Author (pre-implementation) + Reviewer (PR gate) + Merge gate (post-implementation)  
**Coverage**: Proportional to complexity — US1/US3 deep, US4 moderate, US2/US5 light

---

## Architectural Decision Completeness (A1 / A2 / A3)

- [ ] CHK001 — Is A1 (post-merge AW approach) documented in enough detail to implement T002 and
  T003 without requiring any further architectural decisions — covering trigger shim structure, AW
  agent behaviour sequence, idempotency mechanism, and GITHUB_TOKEN forwarding? [Completeness,
  Plan §A1]

- [ ] CHK002 — Is the T001 spike's pass/fail criterion defined precisely enough to produce an
  unambiguous binary outcome? Specifically: is "composite action path resolves correctly" grounded
  in a concrete observable (e.g., `gh aw compile --actionlint` exits 0 with no path errors), and
  is the fallback action on failure (alternate hosting path or scope change) fully specified without
  requiring another decision? [Clarity, Tasks §Phase 1, Plan §A2]

- [ ] CHK003 — If T001 fails (local path resolution unsupported under `src/`), is the fallback
  strategy for A2 documented with enough detail to implement US3 without any additional
  architectural decisions? [Edge Case, Plan §A2]

- [ ] CHK004 — Is A3's conditional error-routing rule specified for every pipeline stage — including
  the post-merge stage, which was not part of the original stage roster when A3 was drafted — and
  is each stage's target (spec PR vs. feature issue) unambiguously assigned? [Completeness,
  Plan §A3]

- [ ] CHK005 — Is the deletion of `error-handler.md` (Plan §A3 Note M1, executed by T010)
  traceable to a task, and is the rationale (dead code; inline routing applied instead) documented
  visibly enough that a reviewer does not reintroduce the file or open a separate work item to
  update it? [Traceability, Tasks §T010]

---

## US1 — Reliable Post-Merge Sub-Issue Creation (P1) 🎯

- [ ] CHK006 — Are the extraction paths for `feature_issue_number`, `spec_directory`, and
  `pr_number` in T002 specified precisely — identifying the PR context block fields and GHA
  expression syntax — or must the implementer consult `research-trigger.yml` to infer the
  pattern? [Clarity, Tasks §T002]

- [ ] CHK007 — Is the "Task Sub-Issue Summary" comment format for T003 fully specified — required
  fields, ordering, per-task status indicators (✅/❌), and posting target (feature issue, not
  spec PR) — so the implementer cannot produce a structurally compliant but semantically wrong
  comment? [Completeness, Spec §FR-012]

- [ ] CHK008 — Is T003's partial-failure surfacing mechanism specified with enough detail to
  implement: which MCP tool posts the failure report, which GitHub object (issue or PR) receives
  it, and what distinguishes a succeeded-task entry from a failed-task entry in the summary?
  [Clarity, Spec §FR-003]

- [ ] CHK009 — Is T003's spec PR comment pagination behaviour specified — does the requirement
  identify the correct MCP call and instruct the implementer to handle cursor-based (not
  fixed-page-number) pagination, so the `<!-- agentic-flow-context -->` sentinel is found
  regardless of comment volume? [Clarity, Spec §FR-013]

- [ ] CHK010 — Is the idempotency mechanism in FR-018 (`issue_read(get_sub_issues)` rather than
  `list_issues`) distinguished in the requirement itself — not only in a plan note — so the
  implementer cannot inadvertently use the wrong API call and ship a silently broken dedup check?
  [Clarity, Spec §FR-018, Plan §A1]

- [ ] CHK011 — Is `issue_read(get_sub_issues)` pagination behaviour specified for T003: what
  happens when the feature issue has more existing sub-issues than fit in a single response page,
  and is the implementer required to paginate through all pages before deciding which tasks to
  skip? [Edge Case, Tasks §T003]

- [ ] CHK012 — Is the zero-task edge case (tasks.md present and readable but yields zero extracted
  tasks) fully specified — what comment is posted to the feature issue, is the run considered
  success or error, and is the feature issue left in a defined state? [Edge Case, Spec §Edge Cases]

- [ ] CHK013 — Are SC-001 and SC-008 measurable with a defined test procedure in T019 — is the
  smoke-test description sufficient to cover both criteria, and is the procedure for simulating a
  partial batch failure (to validate idempotency on rerun) described rather than implied?
  [Measurability, Spec §SC-001, SC-008, Tasks §T019]

- [ ] CHK014 — Is the `gh aw compile` requirement (Plan §A1 Note L1 — AW must be compiled before
  the trigger shim can dispatch it) referenced as an explicit implementation step in T002 or T003,
  so it is not overlooked by an implementer working only from tasks.md? [Completeness,
  Plan §A1 Note L1]

---

## US2 — Successful Tagged Release (P2)

- [ ] CHK015 — Is the T005 local verification script included in the task description with its
  expected output (`OK`) defined, so the implementer can confirm pre-flight validation passes
  locally without triggering the full release pipeline? [Clarity, Tasks §T005]

- [ ] CHK016 — Is SC-002 ("clean checkout") defined precisely enough to reproduce the test —
  does "clean checkout" mean no uncommitted changes, no locally installed tools, a fresh `git
  clone`, or something else — so the smoke test (T020) is unambiguously satisfiable?
  [Measurability, Spec §SC-002]

---

## US3 — Single Authoritative Source for Shared Workflow Logic (P3)

- [ ] CHK017 — Are T006's composite action inputs fully specified with types, allowed values, and
  validation expectations — or would the implementer need to read the three source workflows
  (`plan.md`, `refine.md`, `tasks.md`) to infer what the action must accept? [Completeness,
  Tasks §T006]

- [ ] CHK018 — Is T006's output (`startup-comment-id`) documented with how downstream steps
  are expected to consume it — is there at least one example of a caller stage using this output
  in the task description, so the interface contract is verifiable? [Clarity, Tasks §T006]

- [ ] CHK019 — Is the atomic commit constraint (T009: US3 composite-action refactor + US4
  error-routing fix MUST land in a single commit to `tasks.md`) stated as a requirement — not
  only as an implementation note in tasks.md — such that a PR reviewer can enforce it as a merge
  condition? [Traceability, Tasks §Phase 5 Critical Atomic Constraint, Plan §A3]

- [ ] CHK020 — Is the scope of the "~330-line PR-assignment workaround" block precisely defined —
  is there a canonical reference (section marker, function name, or comment) in each source file
  that lets the implementer verify the extraction is complete and no fragments of the workaround
  remain inline? [Clarity, Plan §A2, Tasks §T007–T009]

- [ ] CHK021 — Is T010's deletion of `workflow-templates/` safe to execute independently of the
  composite action creation, or must T006 be verified functional before T010 removes the dead
  code? Is this sequencing constraint explicit in tasks.md? [Dependency, Tasks §T010]

- [ ] CHK022 — Does SC-003 ("reduced from 3 to 1 location") specify a verification method — e.g.,
  a grep pattern that confirms the workaround block no longer appears verbatim in `plan.md`,
  `refine.md`, or `tasks.md` — so "exactly 1 location" is objectively checkable at merge time?
  [Measurability, Spec §SC-003]

- [ ] CHK023 — Are T007, T008, and T009 explicitly marked in tasks.md as blocked on T006 being
  complete, rather than relying on the implementer to infer the ordering from the dependency graph
  at the bottom of tasks.md? [Dependency, Tasks §Phase 5]

---

## US4 — Correct Pipeline Step Sequencing and Contextual Comments (P4)

- [ ] CHK024 — Is the specific text change for T011 ("Step 6" → "Step 4") grounded in an actual
  read of the current `triage.md` source — is the target step number confirmed rather than assumed
  — so the fix does not introduce a new incorrect reference? [Clarity, Tasks §T011]

- [ ] CHK025 — Is T012's A3 conditional routing update for `spec.md` specified to the same level
  of precision as T007/T008/T009 — covering which trigger context determines the target and which
  MCP call to use — or is `spec.md` underspecified relative to the other three stages?
  [Consistency, Tasks §T012, Plan §A3]

- [ ] CHK026 — Is T013a's deliverable format defined — does the task description state where the
  findings list is recorded (e.g., PR comment, commit message, task annotation), and is the
  done/not-done criterion for T013a unambiguous enough for a reviewer to accept or reject it?
  [Clarity, Tasks §T013a]

- [ ] CHK027 — Is SC-007 ("100% of triggered scenarios") measurable — is the set of
  error-triggering scenarios that must route to the correct target enumerated somewhere (at minimum
  one scenario per stage covered by A3), so "100%" has a bounded denominator? [Measurability,
  Spec §SC-007]

- [ ] CHK028 — Is SC-004 ("zero dangling step references") cross-referenced to T013a/T013b as its
  verification mechanism, or does the success criterion float without a corresponding verification
  task that a merge reviewer can point to? [Traceability, Spec §SC-004, Tasks §T013a]

---

## US5 — Accurate, Internally Consistent Documentation (P5)

- [ ] CHK029 — Is T016's replacement agent roster complete and enumerable without additional
  research — can the implementer derive the full list of operational agents from tasks.md alone,
  or must they independently search `.github/agents/` and `src/.github/agents/` to know what to
  add to the constitution? [Completeness, Tasks §T016]

- [ ] CHK030 — Is T017's scope bounded — is the set of "unimplemented promises" in the
  constitution enumerated in the task description, or is T017 an open-ended sweep whose
  completeness cannot be objectively verified at merge time? [Clarity, Tasks §T017]

- [ ] CHK031 — Is US5's verification-sequencing dependency (full SC-005/SC-006 verification only
  after US1–US4 land) stated prominently enough in tasks.md that a reviewer does not block the
  US5 PR on acceptance criteria being unverifiable before the other stories are merged?
  [Consistency, Tasks §Phase 7 Sequencing Note]

---

## Cross-Cutting: Traceability, Non-Functional, and Merge Gate

- [ ] CHK032 — Does every task (T001–T021) trace back to at least one functional requirement
  (FR-XXX) or success criterion (SC-XXX), and do all eight success criteria (SC-001–SC-008) each
  map to at least one task — with no SC left floating without a verification owner? [Traceability]

- [ ] CHK033 — Is FR-004's closure (the existing checklist format satisfies the requirement without
  modification, per A1 resolution marked ✅ in spec.md) visible enough to a reviewer that no
  separate work item is opened to enforce format changes? [Traceability, Spec §FR-004]

- [ ] CHK034 — Is error-handling behaviour defined for non-429 HTTP failures (e.g., 500 Internal
  Server Error, network timeout, MCP tool call error) during the post-merge sub-issue batch —
  or is retry specified only for HTTP 429, leaving all other failure modes unspecified? [Coverage,
  Gap, Spec §FR-002]

- [ ] CHK035 — Are rollback or revert requirements defined for the three workflow file edits
  (T007/T008/T009) and the dead-code deletion (T010) — specifically, what is the safe recovery
  path if the composite action is deployed but contains a defect that breaks the plan, refine, or
  tasks stages? [Coverage, Gap]

- [ ] CHK036 — Is T021's verification scope sufficient to cover all eight SCs — is there a mapping
  from each SC to the specific evidence T021 must collect, or is "read SC-001 through SC-008
  against post-remediation source files and manual test results" too general to be objectively
  satisfiable at merge time? [Measurability, Tasks §T021]

- [ ] CHK037 — Is the GH_AW_AGENT_TOKEN scope and permissions boundary documented in the
  requirements (not only in plan context), so a security reviewer can verify the token is not
  over-scoped relative to what the composite action actually needs? [Coverage, Gap, Plan §A2]
