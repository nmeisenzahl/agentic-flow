<!--
SYNC IMPACT REPORT
==================
Version change:       3.0.0 → 3.1.0
Bump type:            MINOR — new mandatory multi-model technical validation step
                      added to Principle III; no principles removed or redefined;
                      new row added to Model Assignments table.
Modified sections:
  - Principle III:    "AI Pre-Review at Every Gate" — extended to require a
                      two-layer quality gate: (1) speckit.analyze consistency
                      check followed by (2) parallel multi-model technical
                      validation (claude-opus-4.6 + gpt-5.4), with auto-fix
                      loop capped at 2 combined revision cycles.
  - Model Assignments: New row added — "Multi-model technical validation" with
                      claude-opus-4.6 (correctness/edge-cases/logic) and
                      gpt-5.4 (architecture/API misuse/security).
  - Version/date line updated: 3.0.0 → 3.1.0, Last Amended 2026-04-04.
Added sections:
  - None.
Removed sections:
  - None.
Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check section updated
     to reference multi-model validation requirement (Principle III).
  ✅ .specify/templates/spec-template.md — Validation metadata line added to
     artifact header to surface the two-layer gate to plan authors.
  ✅ .specify/templates/tasks-template.md — Validation note added to artifact
     header to surface the two-layer gate to tasks authors.
  ✅ .specify/templates/checklist-template.md — no changes needed
  ✅ .specify/templates/agent-file-template.md — no changes needed
  ✅ AGENTS.md — intentionally unchanged (source of truth for runtime rules)
  ✅ README.md — no changes needed (references AGENTS.md, not constitution)
Deferred TODOs:       None. All placeholders resolved.
-->

# agentic-flow — Spec-Kit Constitution

> This document guides `speckit.*` workflow agents (specify, plan, tasks, clarify,
> checklist, analyze). For agent pipeline and operational rules, see `AGENTS.md`
> (repo root) — it wins over this file in any conflict.

---

## Role of This Document

`AGENTS.md` defines the runtime pipeline rules every agent MUST follow.
This constitution provides the *spec-kit layer*: named principles, quality
standards, and governance that guide `/speckit.*` commands when producing and
reviewing `spec.md`, `plan.md`, and `tasks.md` artifacts. Together they form
the complete constitutional framework for agentic-flow.

---

## Framework Identity

agentic-flow is a GitHub-native, spec-driven development framework that automates
the full software lifecycle — from raw idea to merged PR — using three pillars:

1. **GitHub Copilot Cloud Agents** — AI agents that run spec, plan, tasks, research,
   and review workflows autonomously.
2. **GitHub Actions / Agentic Workflows** — event-driven orchestration triggered by
   slash commands (`/approve-spec`, `/approve-plan`) and PR/issue events.
   (`ready-to-merge` is applied automatically after tasks pass quality review —
   there is no `/approve-tasks` command.)
3. **spec-kit** — the spec-driven development toolkit providing `/speckit.*` slash
   commands as the human-facing entry point into the pipeline.

The framework is built using itself (dog food). Every change — including amendments
to this constitution — MUST go through the full pipeline.

---

## Core Principles

### I. Spec-First

No code PR MAY be opened before the spec PR for that feature is merged. Artifacts
MUST exist and be approved in sequence: `spec.md` → `plan.md` → `tasks.md`. Each
carries an explicit human approval gate; none may be skipped or combined.

**Rationale**: Premature implementation without reviewed design causes rework and
scope drift. Every artifact in the chain forces alignment before investment is made.

### II. Append-Only

Agents MUST NOT overwrite existing issue or PR body content. Triage MAY reformat
the original body exactly once, preserving the original text verbatim below
`<!-- original-body -->`. All subsequent agent output MUST be posted as new comments.

**Rationale**: Audit trail integrity. Every state transition is permanently visible
in comment history; nothing is silently mutated or lost.

### III. AI Pre-Review at Every Gate

Each generated artifact (spec, plan, tasks) MUST pass two sequential quality
layers before it is surfaced to a human gate:

1. **Consistency check** — `speckit.analyze` runs first and MUST return PASS.
   A FAIL here triggers the auto-revision cycle (see below) before proceeding.

2. **Multi-model technical validation** — Immediately after `speckit.analyze`
   returns PASS, two validators run in parallel:
   - `claude-opus-4.6` — correctness, edge-case coverage, logic integrity.
   - `gpt-5.4` — architecture soundness, API misuse, security anti-patterns.

   Both validators MUST independently return PASS before the artifact is
   presented to a human gate.

**Auto-fix loop**: On any FAIL finding from either layer, the producing agent
MUST auto-revise the artifact and re-run both `speckit.analyze` and the two
technical validators. The loop is capped at **2 revision cycles across both
validators combined**. If the artifact is still FAILING after 2 cycles, it
MUST be escalated to a human with:
- The complete finding list from each validator (speckit.analyze + both models), and
- A brief summary of each auto-revision attempt made.

Agents MUST NOT present a FAILING artifact to a human gate without exhausting
both revision cycles and including the full findings report.

**Rationale**: Protects human review time. `speckit.analyze` catches consistency
and completeness issues; multi-model technical validation catches correctness,
edge-case, architecture, and security concerns that a single model or a single
pass may miss. Humans SHOULD only see artifacts that have passed both layers.

### IV. Dog Food — No Shortcuts

Every change to agentic-flow itself MUST go through the full pipeline:
Triage → Research → Spec → Plan → Tasks → Implementation → Review → Merge.
Hotfixes, direct pushes to the default branch, and pipeline bypasses are forbidden.

**Rationale**: The framework validates itself. Any broken pipeline phase is caught
by the team's own workflow before it ships to users.

### V. Exactly Four Human Gates

Human blocking input is restricted to exactly these four interactions:

1. Answering clarifying questions in the spec PR.
2. `/approve-spec`
3. `/approve-plan`
4. Merging the spec PR.

Agents MUST NOT introduce additional blocking approval requests or wait-states
outside these four gates. The `ready-to-merge` label is applied automatically
by `speckit-driver` when `speckit.analyze` returns PASS on `tasks.md` — no
`/approve-tasks` command exists in this architecture.

**Rationale**: Preserves the "AI does the heavy lifting" contract. The tasks
quality gate (`speckit.analyze` PASS) is a stronger signal than a manual approval
step. Four gates achieve the same audit trail with less ceremony.

### VI. Traceability

All cross-references in issue and PR content MUST use merge-commit SHA blob URLs
(permanent links). Branch-relative URLs are forbidden in issue and PR bodies.
Commits MUST follow Conventional Commits format:
`<type>(<scope>): <description> (#N)` where type ∈
`{feat, fix, chore, docs, test, refactor, perf, ci}`.

**Rationale**: Permanent links ensure referenced artifacts remain accessible after
branch deletion or force-push. Conventional commits enable automated changelog
generation and semantic version inference.

### VII. Test Coverage Floor

Test coverage MUST NOT drop below 90% on any PR. All tests MUST pass before a PR
is marked ready for review. Coverage regressions block merge.

**Rationale**: The 90% floor reflects the framework's self-validating nature.
agentic-flow generates and reviews code; it must produce verifiably correct output.

---

## Pipeline

| Phase | Trigger | Output |
|-------|---------|--------|
| Triage | Issue opened | Formatted feature issue, `needs-spec` or `needs-refinement` label |
| Research | Auto after triage passes | Research comment on issue |
| Spec | `/start-spec` | `specs/{NNN}-{name}/spec.md` |
| Plan | `/approve-spec` | `specs/{NNN}-{name}/plan.md` |
| Tasks | `/approve-plan` | `specs/{NNN}-{name}/tasks.md` |
| Work Items | spec PR merged | Task sub-issues on board |
| Implementation | Task issue assigned | Draft PR per task |
| Review | PR marked ready | Security, AC, architecture, coverage verdicts |
| Merge | All gates passed | Squash merge, board updated |

---

## Human Gates

1. Answer clarifying questions in the spec PR
2. `/approve-spec`
3. `/approve-plan`
4. Merge the spec PR

No other blocking human interactions. No exceptions.

---

## Model Assignments

| Task | Model |
|------|-------|
| Spec, research, security review, AC validation | `claude-opus-4.6` |
| Plan, tasks, implementation, coordination | `claude-sonnet-4.6` |
| Architecture review | `gpt-5.4` |
| Multi-model technical validation — correctness, edge cases, logic | `claude-opus-4.6` |
| Multi-model technical validation — architecture, API misuse, security | `gpt-5.4` |

---

## Agent Roster

| Agent | Responsibility |
|-------|----------------|
| `speckit-driver` | Runs the spec pipeline; handles slash commands |
| `feature-researcher` | Domain research before spec begins |
| `feature-implementer` | Implements task issues, opens code PRs |
| `review-orchestrator` | Coordinates security, AC, architecture, coverage reviews |

---

## Spec-Kit Workflow Quality Standards

These standards apply to every artifact produced by `/speckit.*` commands. AI
review agents MUST validate against these standards before issuing a PASS verdict.
A single unexplained violation MUST produce a FAIL and trigger auto-revision.

### spec.md Quality Standards

- MUST contain at least one P1 user story with full Gherkin acceptance scenarios
  (Given / When / Then).
- Each user story MUST be independently testable: implementing it alone MUST deliver
  demonstrable, deployable value without depending on lower-priority stories.
- Functional requirements MUST use RFC 2119 modal verbs: MUST, SHOULD, MAY.
  Vague language ("should probably", "might need to") is not acceptable.
- Ambiguous requirements MUST be marked `[NEEDS CLARIFICATION: <reason>]` rather
  than silently resolved by assumption.
- Success criteria MUST be measurable, technology-agnostic, and directly traceable
  to at least one acceptance scenario.
- Scope boundaries (what is explicitly out of scope) MUST be stated.

### plan.md Quality Standards

- MUST reference the approved `spec.md` by merge-commit SHA blob URL (Principle VI).
- The Constitution Check section MUST contain an explicit PASS or FAIL verdict for
  each active principle (I–VII), with a one-line justification per entry.
- Technical choices MUST be justified inline. Violations of any principle MUST
  appear in the Complexity Tracking table with rationale and rejected alternatives.
- All file paths in the Project Structure section MUST be concrete. No placeholder
  tokens (e.g., `[path]`, `[language]`) may remain in a delivered plan.
- Performance goals and constraints MUST match or tighten the success criteria
  stated in `spec.md`.

### tasks.md Quality Standards

- Tasks MUST be organized by user story phase, in spec.md priority order (P1 first).
- Every task MUST reference exactly one user story via its `[USN]` tag.
- Tasks MUST be atomic: single file, single responsibility, completable in one agent
  session without mid-task blocking decisions.
- Tasks marked `[P]` (parallel) MUST genuinely share no file or shared-state
  dependency with other `[P]` tasks in the same phase.
- Each user-story phase MUST end with an explicit, independently runnable test
  checkpoint confirming that story works before the next phase begins.
- When tests are included, test tasks MUST precede their paired implementation tasks
  and MUST be explicitly noted to fail on first run (Red-Green-Refactor).

---

## Governance

### Amendment Procedure

1. Open a feature issue against `agentic-flow` describing the proposed amendment.
2. The full pipeline applies (Principle IV — Dog Food). No constitution-specific
   shortcuts exist.
3. The spec PR for the amendment MUST include the updated `constitution.md` as a
   committed file artifact (not only a comment).
4. Human gate 5 (merging the spec PR) ratifies the amendment.
5. `LAST_AMENDED_DATE` MUST be updated to the merge date; `CONSTITUTION_VERSION`
   MUST be bumped per the Versioning Policy below.

### Versioning Policy

`CONSTITUTION_VERSION` follows semantic versioning (`MAJOR.MINOR.PATCH`):

- **MAJOR** — Removal or redefinition of a core principle; backward-incompatible
  governance change.
- **MINOR** — New principle or section added; material expansion of existing
  guidance that changes what agents are required to do.
- **PATCH** — Clarifications, wording fixes, typo corrections; no semantic change
  to any requirement or obligation.

When the bump type is ambiguous, the agent proposing the change MUST state its
reasoning in the spec PR before the human gate.

### Compliance Review

Every AI pre-review pass on a `plan.md` artifact MUST include a Constitution Check
table: a per-principle PASS/FAIL assessment with one-line justification. A FAIL on
any principle without documented justification blocks the artifact from reaching the
human gate and triggers the auto-revision cycle (Principle III).

---

**Version**: 3.1.0 | **Ratified**: 2026-04-04 | **Last Amended**: 2026-04-04
