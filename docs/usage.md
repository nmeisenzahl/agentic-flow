# agentic-flow — Usage Reference

Quick reference for adopters: slash commands, pipeline overview, and configuration.

---

## Slash Commands

Slash commands are posted as comments on Feature issues or spec PRs.

| Command | Posted on | Trigger | Preconditions | Output |
|---------|-----------|---------|---------------|--------|
| `/retry-triage` | Feature issue | Re-runs Phase 0 triage | None | Issue reformatted, labels re-evaluated |
| `/start-spec` | Feature issue | Starts Phase 2 spec generation | `research-complete` label; no `needs-refinement` | Draft spec PR created; `spec.md` generated |
| `/refine-spec` | Spec PR | Regenerates `spec.md` on open spec branch | Open spec PR; `spec.md` exists on branch; no `plan.md` yet | Updated `spec.md` committed to existing branch; PR review comment |
| `/approve-spec` | Spec PR | Starts Phase 3 plan generation | `spec.md` exists on branch; no `plan.md` yet; no `[NEEDS CLARIFICATION:]` in spec.md | `plan.md` generated; review comment on same PR |
| `/approve-plan` | Spec PR | Starts Phase 4 tasks generation | `spec.md` and `plan.md` exist on branch; no `tasks.md` yet; no `[NEEDS CLARIFICATION:]` in plan.md | `tasks.md` generated on PASS |
| `/rerun-audit` | Feature PR | Re-runs audit for first open audit task | Open feature PR with `agentic-flow-audit` sub-issues; audit found issues | Dispatches `audit-dispatch.yml` for first open audit task |

**Note**: `/start-spec` and `/retry-triage` are phase-trigger commands, not approval gates. `/refine-spec` updates `spec.md` without advancing the pipeline. `/rerun-audit` re-dispatches the audit agent for the first open audit task on the feature PR (use after the audit agent requested changes and you have addressed them). The four approval gates are: (1) answer clarifying questions, (2) `/approve-spec` (on spec PR), (3) `/approve-plan` (on spec PR), (4) merge the spec PR.

---

## Pipeline Overview

### From the User's Perspective

| Step | You do | Happens automatically |
|------|--------|-----------------------|
| 1 | Open a Feature issue | Triage: issue formatted, `needs-spec` label applied |
| 2 | — | Research: findings appended to issue body; notification comment |
| 3 | Review research; post `/start-spec` | Spec: draft PR + `spec.md` generated via quality gate chain |
| 4 | Review spec; answer clarifications; post `/approve-spec` on the spec PR | Plan: `plan.md` generated via quality gate chain |
| 5 | Review plan; post `/approve-plan` on the spec PR | Tasks: `tasks.md` generated on PASS |
| 6 | Review tasks; merge spec PR | Post-merge: Task issues created, linked as sub-issues |
| 7 | — | Implementation: feature branch created; each task is implemented by Copilot on its own branch and auto-merged via PR |
| 8 | — | Audit: each audit task validated by Copilot on the feature PR (APPROVE or REQUEST_CHANGES) |
| 9 | Address any audit findings (if REQUEST_CHANGES); post `/rerun-audit` | Audit re-runs on the feature PR |
| 10 | Review feature PR; merge to `main` | Feature merged to `main`; feature issue closed |

### In-PR Iteration with `/refine-spec`

After step 3 (reviewing the spec), you may have substantive feedback that requires regenerating the spec rather than just commenting. Use `/refine-spec` to incorporate reviewer feedback into a revised `spec.md` without restarting the pipeline:

1. Post review comments on the spec PR
2. Comment `/refine-spec` on the spec PR
3. The `refine.md` agent reads all open review comments and regenerates `spec.md` on the existing branch
4. Review the updated spec and continue from step 4 when satisfied

**When to use `/refine-spec` vs just commenting**: Use `/refine-spec` when you have structural or requirements-level feedback that changes what is specified. For minor wording fixes or clarifications that don't affect scope, comment directly and post `/approve-spec` on the spec PR when ready.

**Constraint**: `/refine-spec` cannot be used after `/approve-spec` has already run (`plan.md` exists on the branch). At that point, update `plan.md` directly on the spec PR branch as needed and use `/approve-plan` only when the plan is ready to proceed to tasks generation.

### Phase Timing

| Phase | Typical duration |
|-------|-----------------|
| 0 Triage | ≤5 minutes |
| 1 Research | ≤15 minutes |
| 2 Spec | ≤10 minutes after `/start-spec` |
| 3 Plan | ≤10 minutes after `/approve-spec` |
| 4 Tasks | ≤10 minutes after `/approve-plan` |
| 5 Post-merge | ≤5 minutes after merge |
| 6 Implementation | Depends on number of tasks and CI duration; each task runs sequentially |
| 7 Audit | ≤15 minutes per audit task after all implementation tasks complete |

Total human interaction time (not including reading/thinking): ≤30 minutes

---

## Label-Stuck Recovery

If a pipeline phase crashes mid-run, labels may get stuck. Use these commands to clean up:

```bash
# research-in-progress stuck (research agent crashed)
gh issue edit {ISSUE_NUMBER} --remove-label research-in-progress

# needs-spec not applied after triage
gh issue edit {ISSUE_NUMBER} --add-label needs-spec

# spec-in-progress stuck after spec PR was closed
gh issue edit {ISSUE_NUMBER} --remove-label spec-in-progress
```

---

## Common Workflows

### Re-run Triage

Post `/retry-triage` as a comment on the issue. Triage is idempotent — it will update the structured sections without duplicating the `<!-- original-body -->` block.

### Skip Research (not recommended)

If you need to bypass research (e.g., for a simple housekeeping task), manually apply `research-complete` label:
```bash
gh issue edit {ISSUE_NUMBER} --add-label research-complete
```
Then post `/start-spec`.

### Re-run a Phase

All slash commands are idempotent:
- `/approve-spec` with an existing `plan.md` → shows idempotency notice
- `/approve-plan` with an existing `tasks.md` → shows idempotency notice

Re-running `/start-spec` when a spec PR exists → agent posts link to the existing PR instead of creating a duplicate.

### Re-run Post-merge

Re-run from the GitHub Actions UI (dispatch the **Create Task Issues** workflow) with the same `feature_issue_number`, `spec_directory`, `pr_number`, and `merge_commit_sha`. The workflow is idempotent — the safe-output job fetches `tasks.md` directly, parses it in JavaScript, and skips any task whose title already matches an existing sub-issue on the feature issue.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Workflow doesn't trigger | Check coding agent is enabled; verify `.lock.yml` is committed |
| Agent can't write to repo | Ensure GitHub MCP server is active in Settings → Copilot → MCP servers |
| Research doesn't start | Verify `research-trigger.yml` has `actions: write` permission; check `needs-spec` label exists |
| `gh aw compile` fails | Run `gh aw compile --actionlint` for details |
| Sub-issues not linking | Confirm `sub_issue_id` is the integer `id` field, not `node_id` |
| Wrapper agent never starts after slash command | Verify `GH_AW_AGENT_TOKEN` is configured; all wrapper-agent handoffs (`/start-spec`, `/refine-spec`, `/approve-spec`, `/approve-plan`) use it for the PR assignment + startup-comment handoff that launches the wrapper agent |
| `/start-spec` rejected | Check issue has `research-complete` label; verify no `needs-refinement` label is set |
| `/refine-spec` rejected | Verify open spec PR exists and `plan.md` is NOT yet on the branch |
| `/approve-spec` rejected | Verify `spec.md` exists on the spec PR's branch and command was posted on the spec PR |
| `/approve-plan` rejected | Verify both `spec.md` and `plan.md` exist on the branch and command was posted on the spec PR |
| Implementation doesn't start after `tasks-created` | Verify `implement-trigger.yml` is deployed; check that the post-merge workflow posted the `<!-- agentic-flow-implement-ready -->` block to the feature issue; verify `GH_AW_AGENT_TOKEN` secret has `actions: write` |
| Task implementation agent never starts | Verify `implement-dispatch.yml` dispatched; check that `agentic-flow-implement.agent.md` is deployed and `COPILOT_MCP_GITHUB_WRITE_TOKEN` is in the `copilot` environment |
| Task PR not auto-merging | Verify `implement-merge.yml` is deployed; check CI status on the task PR; verify `ready-to-merge-task` label was applied by the agent |
| Audit doesn't start after all tasks merged | Verify `audit-dispatch.yml` is deployed; check feature issue sub-issues include open `agentic-flow-audit` tasks |
| Audit agent requested changes; how to re-run | Fix the code on the feature branch, then post `/rerun-audit` on the feature PR |
| Feature PR still in draft after all audits approved | Check `audit-chain-trigger.yml` is deployed and fired on the last audit issue close |

---

## Pipeline Walkthrough

A complete feature flows through these phases:

| Phase | Who acts | What happens |
|-------|----------|--------------|
| **0 — Triage** | Agent (auto) | `triage-trigger.yml` fires on issue open → `triage.md` reformats the issue, classifies it |
| **1 — Research** | Agent (auto) | `research-trigger.yml` fires on `needs-spec` label → `research.md` appends findings to issue |
| **2 — Spec** | You (post `/start-spec`) | `spec.md` creates a tracking sub-issue, then the assignment workflow creates a branch and draft PR and assigns `agentic-flow-spec` directly to that PR |
| *(optional)* **Refine** | You (post `/refine-spec` on PR) | `refine.md` reads PR review comments and regenerates `spec.md` on the existing branch |
| **3 — Plan** | You (post `/approve-spec` on spec PR) | `plan.md` dispatches `agentic-flow-plan`; generates `plan.md` and any speckit-required plan-stage outputs on the spec branch |
| **4 — Tasks** | You (post `/approve-plan` on spec PR) | `tasks.md` dispatches `agentic-flow-tasks`; generates `tasks.md` and any speckit-required tasks-stage outputs on PASS |
| **5 — Post-merge** | You (merge the PR) | `post-merge-trigger.yml` dispatches `post-merge.md` AW → creates Task sub-issues |
| **6 — Implementation** | Agent (auto) | `implement-trigger.yml` fires on `tasks-created` label → creates feature branch + draft PR → `implement-dispatch.yml` assigns `agentic-flow-implement` to each task PR in dependency order; each task PR is auto-merged when CI passes |
| **7 — Audit** | Agent (auto) | `audit-dispatch.yml` assigns `agentic-flow-audit` to the feature PR for each audit task issue; each audit task posts a PR review (APPROVE or REQUEST_CHANGES) |
| **8 — Merge** | You | Review feature PR; merge to `main` |

For full setup instructions, see [docs/init.md](init.md).

---

## Failure Modes Reference

| Failure | Likely Cause | Recovery |
|---------|-------------|----------|
| Post-merge doesn't fire after merge | PR merged without `ready-to-merge` label — the trigger requires this label | Rerun `post-merge.lock.yml` manually from the GitHub Actions UI (workflow_dispatch) |
| Research label stuck | `research.md` crashed after label apply | `gh issue edit {N} --remove-label research-in-progress`, then re-dispatch |
| `/start-spec` rejected — needs refinement | Issue body lacks enough detail | Update issue with more detail; run `/retry-triage` to reclassify |
| `/start-spec` rejected — no research | Phase 1 didn't complete | Manually dispatch `research.lock.yml` or check agent settings |
| `spec.md` still has unresolved clarifications | `agentic-flow-spec` exhausted its clarify/analyze loop and surfaced findings for human review | Address the findings in the spec PR, push, then comment `/approve-spec` on the spec PR |
| `ready-to-merge` not applied | Tasks analyze or checklist failed — tasks agent must pass both before applying | Re-run `/approve-plan` |
| Sub-issues not linked | Sub-issues beta not enabled | Enable sub-issues in Settings → General |
| Implementation pipeline stalled | Agent session timed out; task PR has no `ready-to-merge-task` label | Manually dispatch `implement-dispatch.yml` from the GitHub Actions UI with the same inputs to re-assign the agent |
| Task PR CI failing after agent completed | Agent committed broken code | Review the task PR; fix code manually or re-dispatch implement-dispatch to re-assign agent |
| Audit chain stalled | Audit agent left audit task issue open (REQUEST_CHANGES path) | Address audit findings; post `/rerun-audit` on the feature PR |
