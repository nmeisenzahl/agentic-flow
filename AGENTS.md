# agentic-flow — Developer Guide

> This file is a developer guide for contributors to the agentic-flow framework.
> **Runtime agent rules** live exclusively in `src/.github/copilot/instructions.md`.

---

## Development Rule: Spec-First, Always

**All changes to this framework — features, fixes, refactors — MUST go through the
spec-kit pipeline using the specify slash commands. No development outside this process.**

The workflow:
1. `/speckit.specify` → `/speckit.clarify` (iterate until crisp) → `/speckit.analyze`
2. `/speckit.plan` → `/speckit.analyze`
3. `/speckit.tasks` → `/speckit.analyze` → `/speckit.checklist`
4. `/speckit.implement` against the tasks in the spec

This applies to every contributor, including AI agents. Committing code or docs
without a merged spec is a process violation.

---

## Repository Structure

| Path | Purpose |
|------|---------|
| `src/` | Framework source; shipped to users via release zip (src/ prefix stripped) |
| `src/.github/agents/` | Agentic-flow wrapper agents (`agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`) that consume speckit docs installed by `specify init` |
| `src/.github/workflows/` | `.md` agentic workflow sources + standard GHA workflows (`.lock.yml` compiled outputs are gitignored — users generate them) |
| `src/.github/actions/` | Composite actions (e.g. `assign-pr-agent`) extracted from inline safe-output job blocks |
| `src/.github/copilot/instructions.md` | Agent constitution — authoritative agent runtime rules |
| `.github/workflows/` | Dev-only tooling (`release.yml`, speckit CI) — NOT distributed |
| `docs/` | User-facing documentation shipped in release zip (`README.md`, `init.md`, `usage.md`) |
| `specs/` | Framework development specs (excluded from zip) |

---

## Edit/Compile Cycle

How to work with agentic workflow `.md` files:

1. Edit the `.md` source file in `src/.github/workflows/`
2. Run `gh aw compile src/.github/workflows/<file>.md` to regenerate `<file>.lock.yml` locally
3. Verify it compiles cleanly — **do not commit** `.lock.yml` files (they are gitignored in this dev repo and excluded from the release zip; each adopting project compiles and commits its own)

### Compile all agents

```bash
gh aw compile src/.github/workflows/triage.md \
              src/.github/workflows/research.md \
              src/.github/workflows/spec.md \
              src/.github/workflows/plan.md \
              src/.github/workflows/tasks.md \
              src/.github/workflows/refine.md \
              src/.github/workflows/post-merge.md
```

### Verify compiled outputs are current

```bash
for aw in src/.github/workflows/*.md; do
  lock="${aw%.md}.lock.yml"
  [ -f "$lock" ] || echo "MISSING (compile locally): $lock"
done
```

> Lock files are gitignored and excluded from the release zip. Run `gh aw compile` locally to verify, but do not commit the output.

---

## Dogfooding

Using the agentic-flow pipeline to develop the framework itself (running triage,
research, and post-merge workflows against this repo) is a **planned future capability**.
Framework source lives under `src/.github/`, but GitHub Actions and Copilot look for
files under `.github/`. A future spec will address this. For now, the framework is
developed using spec-kit locally via the specify slash commands.

---

## Architecture Decision Records

| Decision | Rationale |
|----------|-----------|
| `src/` prefix exists | Distribution packaging strips it on extraction — users get `.github/` at their repo root |
| `release.yml` is root dev tooling, not distributed | The release workflow packages the framework for distribution — user repos do not need it (PA-013-F2) |
| Triage uses single file (`triage.md`) | `gh aw` supports combining `workflow_dispatch` and `slash_command` triggers in one `.md` — merged during PA-013-F8; `retry-triage.md` deleted |
| `/refine-spec` only re-runs spec phase | Regenerating plan and tasks from a refined spec is already handled by the existing `/approve-spec` → `plan.md` → `/approve-plan` → `tasks.md` flow (PA-013-F11) |
| `/approve-spec` and `/approve-plan` fire on spec PR | Phase guards now use file-existence checks on the PR branch; removes dependency on labels and pause-point comments (004-pr-slash-commands) |
| All wrapper-agent handoffs use a custom PR assignment workaround | The `gh aw` built-in `assign_to_agent` gives Copilot a token scoped to the assigned issue/sub-issue, not the PR — so PR writes fail. All four wrapper handoffs (`/start-spec`, `/refine-spec`, `/approve-spec`, `/approve-plan`) now use `GH_AW_AGENT_TOKEN` + `replaceActorsForAssignable` to assign Copilot directly to the spec PR and post a startup comment |
| agentic-flow ships wrappers, not speckit phase docs | `specify init` provides `.github/agents/speckit.*.agent.md`; agentic-flow wrappers adapt those docs to the existing PR/sub-issue environment without creating new branches or PRs |

---

## Pipeline Overview (Summary)

| Phase | Trigger | Agent/Workflow | Output |
|-------|---------|----------------|--------|
| 0 — Triage | Issue opened | `triage.md` | Formatted Feature issue, `needs-spec` label |
| 0 — Re-triage | `/retry-triage` | `triage.md` | Issue re-classified |
| 1 — Research | `needs-spec` label | `research-trigger.yml` → `research.md` | Research findings on issue |
| 2 — Spec | `/start-spec` | `spec.md` → `agentic-flow-spec` | `specs/{NNN}/spec.md` (+ spec-stage supporting files if speckit requires them) |
| Spec refinement | `/refine-spec` | `refine.md` → `agentic-flow-spec` | Updated `spec.md` on open spec branch |
| 3 — Plan | `/approve-spec` | `plan.md` → `agentic-flow-plan` | `specs/{NNN}/plan.md` (+ plan-stage supporting files if speckit requires them) |
| 4 — Tasks | `/approve-plan` | `tasks.md` → `agentic-flow-tasks` | `specs/{NNN}/tasks.md` (+ tasks-stage supporting files if speckit requires them) |
| 5 — Post-merge | Spec PR merged | `post-merge-trigger.yml` → `post-merge.md` | Task sub-issues created |

> Agent runtime behavioural rules are in `src/.github/copilot/instructions.md`.

---

## Acceptance Test Criteria

| Test | How |
|------|-----|
| **Smoke test** | Create a test issue → verify triage agent fires, issue is formatted, `needs-spec` label is applied |
| **Pipeline test** | Run `/refine-spec` on an open spec branch → verify `spec.md` is regenerated on the existing branch |
| **Release test** | Push a test tag → verify release zip is created; run the validation array from `release.yml` locally against the extracted zip |

For a full acceptance test checklist, see the Testing section in `docs/contributing.md`.
