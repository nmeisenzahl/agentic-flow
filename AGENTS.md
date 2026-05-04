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
| `src/.github/agents/` | Agentic-flow wrapper agents (`agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`, `agentic-flow-implement`, `agentic-flow-audit`) that consume speckit docs installed by `specify init` |
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

> Note: `implement-trigger.yml`, `implement-dispatch.yml`, `implement-merge.yml`, `audit-dispatch.yml`, `audit-chain-trigger.yml`, and `rerun-audit-trigger.yml` are standard GHA YAML workflows (not agentic workflow `.md` files) — they are not compiled with `gh aw`.

### Verify compiled outputs are current

```bash
for aw in src/.github/workflows/*.md; do
  lock="${aw%.md}.lock.yml"
  [ -f "$lock" ] || echo "MISSING (compile locally): $lock"
done
```

> Lock files are gitignored and excluded from the release zip. Run `gh aw compile` locally to verify, but do not commit the output.

### Compile in adopting project

Adopting repos must compile and commit lock files after installing or updating `.md` workflow sources. Both the `.md` source and its `.lock.yml` must always be in sync — updating one without the other causes a "Lock file outdated" error at runtime.

```bash
gh aw compile .github/workflows/*.md
git add .github/workflows/*.lock.yml
git commit -m "chore: compile agentic workflow lock files"
```

> **Important:** When manually updating a `.md` workflow source, always recompile and commit the corresponding `.lock.yml`. Never update the `.lock.yml` alone without also updating its `.md` source.

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
| Copilot coding agent commits via `create_or_update_file` API (not `git push`) | When assigned to a PR (not an issue), the Copilot integration token lacks `contents: write`, so `git push` always fails with 403. All three wrapper agents use the `create_or_update_file` MCP tool backed by `COPILOT_MCP_GITHUB_WRITE_TOKEN` as the sole commit path. `copilot-setup-steps.yml` is shipped as an optional environment-preparation template, not for credential injection. |
| MCP config lives in agent YAML frontmatter (not repo UI) | Each wrapper agent declares its own `mcp-servers:` block with a `github-write` server pointing at `api.githubcopilot.com/mcp/`. This ships the MCP config as code, enables per-agent least-privilege tool lists, and avoids dependency on manual repo-level UI configuration. The `copilot` environment secret `COPILOT_MCP_GITHUB_WRITE_TOKEN` is still required. |
| Post-merge safe-output job parses `tasks.md` directly (not agent JSON) | LLMs cannot reliably serialize complex markdown into valid JSON. The `create-task-issues` safe-output job fetches `tasks.md` at the merge commit SHA via `repos.getContent()` and parses it in JavaScript. The agent's only job is to verify the file exists and pass through inputs. Idempotency check (skip tasks with existing sub-issues) also runs in JS. |
| Three-tier merge: task branch → feature branch → main | Each implementation task gets its own branch + PR targeting the feature branch. Task PRs auto-merge when CI passes. Only the feature branch PR (targeting main) requires human review. This isolates task CI failures from the main branch and provides a single holistic diff for human review. |
| Sequential task dispatch (not parallel) | Tasks are dispatched one at a time in dependency order. Each task's agent session completes and the task PR is merged before the next task is dispatched. This ensures each agent session sees the current state of the feature branch and eliminates merge conflicts between concurrent task branches. |
| Auto-merge via GHA workflow (not agent-initiated) | The `implement-merge.yml` workflow verifies CI status and merges task PRs — the agent never directly merges. This decouples agent session lifetime from merge timing and provides a reliable CI gate. |
| Audit tasks as feature PR reviews (not implementations) | Audit task issues (labeled `agentic-flow-audit`) are dispatched to `agentic-flow-audit` which reviews the **entire feature branch diff** (not individual task changes). This gives the auditor the full picture and produces a single PR review comment rather than per-task reviews. |
| APPROVE closes audit issue; REQUEST_CHANGES leaves it open | The audit chain (next audit dispatch or ready-to-merge) is triggered by issue close events. Only APPROVE closes the audit task issue. REQUEST_CHANGES leaves it open, blocking the chain until the human fixes issues and posts `/rerun-audit`. |
| Implementation and audit dispatch workflows use standard GHA YAML | Unlike `spec.md`, `plan.md`, etc., the implementation/audit orchestration is pure GHA JavaScript — no `gh aw` agentic workflow needed. The agent assignment step still uses the `assign-pr-agent` composite action for consistency. |
| No automatic reconciliation for partial-success pipeline failures | If a task PR merges but a downstream step (close issue, dispatch next) fails, the pipeline stalls. Recovery is manual: inspect feature issue sub-issues and re-run the failed workflow. A dedicated reconciliation workflow is a planned future enhancement. |
| No watchdog for silent agent timeouts | If an agent session fails to apply `ready-to-merge-task` or close an audit issue, the pipeline hangs. Manual recovery via `/rerun-audit` (audit) or workflow re-run (implementation). Scheduled timeout detection is a planned future enhancement. |
| `mergeable` + check-runs vs `mergeStateStatus` UNSTABLE | `mergeStateStatus` is set to `UNSTABLE` by GitHub when legacy Commit Status API returns `pending` with zero entries — common in repos with no CI. `implement-merge.yml` uses `mergeable` (GraphQL) + explicit check-run listing instead, bypassing the false UNSTABLE state. Pass allowlist (`success\|neutral\|skipped`) instead of failure denylist correctly handles all-pending and in-progress states. |

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
| 6 — Implementation | `tasks-created` label | `implement-trigger.yml` → `implement-dispatch.yml` → `agentic-flow-implement` | Task branches + auto-merged task PRs into feature branch |
| 7 — Audit | All implementation tasks done | `audit-dispatch.yml` → `agentic-flow-audit` | PR review on feature PR; audit task issues closed |
| 8 — Merge | Human | Human reviews feature PR + merges | Feature on `main` |

> Agent runtime behavioural rules are in `src/.github/copilot/instructions.md`.

---

## Acceptance Test Criteria

| Test | How |
|------|-----|
| **Smoke test** | Create a test issue → verify triage agent fires, issue is formatted, `needs-spec` label is applied |
| **Pipeline test** | Run `/refine-spec` on an open spec branch → verify `spec.md` is regenerated on the existing branch |
| **Release test** | Push a test tag → verify release zip is created; run the validation array from `release.yml` locally against the extracted zip |
| **Implementation smoke test** | Apply `tasks-created` label to a feature issue with task sub-issues → verify feature branch created, draft PR opened, first task dispatched to `implement-dispatch.yml` |
| **Auto-merge test** | Task PR with `ready-to-merge-task` label + passing CI → verify `implement-merge.yml` squash-merges it, closes task issue, dispatches next task or audit |
| **Audit chain test** | Close an audit task issue with `agentic-flow-audit` label → verify `audit-chain-trigger.yml` fires and dispatches next open audit task or marks feature PR ready |

For a full acceptance test checklist, see the Testing section in `docs/contributing.md`.
