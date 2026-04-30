# agentic-flow — Runtime Context

This file defines **framework-wide invariants only**. Do not use it for phase-specific generation behavior. Spec, plan, and tasks execution rules live in the wrapper agents and the referenced speckit documents.

## Pipeline

| Stage | Trigger | Dispatcher | Result |
|-------|---------|------------|--------|
| Triage | Issue opened / `/retry-triage` (slash command) | `triage-trigger.yml` → `triage.md` / `triage.md` | Formatted Feature issue + labels |
| Research | `needs-spec` label | `research-trigger.yml` → `research.md` | Research findings added to the Feature Issue |
| Spec | `/start-spec` on Feature Issue | `spec.md` → `agentic-flow-spec` | Spec-stage files on the spec PR branch |
| Refine | `/refine-spec` on spec PR | `refine.md` → `agentic-flow-spec` | Updated spec-stage files on the same branch |
| Plan | `/approve-spec` on spec PR | `plan.md` → `agentic-flow-plan` | Plan-stage files on the same branch |
| Tasks | `/approve-plan` on spec PR | `tasks.md` → `agentic-flow-tasks` | Tasks-stage files on the same branch |
| Post-merge | Spec PR merged | `post-merge-trigger.yml` → `post-merge.md` | Task sub-issues created |
| Implementation | `tasks-created` label on Feature issue | `implement-trigger.yml` → `implement-dispatch.yml` → `agentic-flow-implement` | Code changes on task branches; auto-merged into feature branch |
| Audit | All implementation tasks done | `audit-dispatch.yml` → `agentic-flow-audit` | PR review (APPROVE/REQUEST_CHANGES) on feature PR; audit task issues closed |
| Merge | Human | Human reviews feature PR + merges | Feature changes land on `main` |

## Framework Rules

- **Spec-first.** Never skip ahead of the active phase.
- **Existing branch/PR only.** Wrapper agents must use the GitHub-assigned branch and current spec PR. Never create a new branch or PR.
- **No bootstrap.** Never run `specify init`. Speckit files are a prerequisite, not something the wrapper bootstraps.
- **Context first.** Read the latest `<!-- agentic-flow-context -->` block before acting. It is the workflow handoff contract.
- **PR-first communication.** Wrapper-agent summaries, failures, and next-step instructions belong on the spec PR, not the Feature Issue.
- **Append-only collaboration.** Triage may reformat the Feature Issue once. Research may append `## Research Findings` once. After that, agent communication is comment-only.
- **Stage-scoped writes.** Only create or update files that belong to the active stage. The wrapper agent defines the exact allowed artefacts.
- **Task-branch-scoped writes.** `agentic-flow-implement` must only commit to its assigned task branch via `create_or_update_file`. It must never modify the feature branch directly, create new branches, or merge PRs.
- **Explicit handoff.** Every wrapper summary or recovery comment must state the next slash command or manual reviewer step.

## Labels

| Label | Meaning |
|-------|---------|
| `needs-spec` | Feature Issue is ready for spec |
| `needs-refinement` | Feature Issue lacks enough detail for spec |
| `research-in-progress` / `research-complete` | Research status |
| `spec-in-progress` | Spec PR exists and the spec pipeline is active |
| `ready-to-merge` | `agentic-flow-tasks` applies this when analyze + checklist both pass — merge the PR when ready |
| `tasks-created` | All task sub-issues created — pipeline complete (terminal state) |
| `agentic-flow-task` | Applied to every task sub-issue created by the post-merge workflow |
| `agentic-flow-audit` | Applied to audit/review task sub-issues (title starts with Audit, Review, Verify, or Validate) |
| `implementing` | Feature issue: implementation phase is in progress |
| `implementation-complete` | Feature issue: all implementation tasks merged; audit/review phase |
| `agentic-flow-task-pr` | Applied to task PRs targeting the feature implementation branch |
| `ready-to-merge-task` | Agent signals task PR is complete — triggers auto-merge by `implement-merge.yml` |

## Wrapper Ownership

| Wrapper | Responsibility |
|---------|----------------|
| `agentic-flow-spec` | Spec generation/refinement using speckit spec + clarify + analyze |
| `agentic-flow-plan` | Plan generation using speckit plan + analyze |
| `agentic-flow-tasks` | Tasks generation using speckit tasks + analyze + checklist |
| `agentic-flow-implement` | Code implementation on the assigned task branch using task issue context + spec artifacts |
| `agentic-flow-audit` | Code review and validation on the feature PR using audit task issue context |
