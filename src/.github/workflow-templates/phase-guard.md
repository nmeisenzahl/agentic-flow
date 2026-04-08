# Phase Guard — file-existence checks (FR-007, FR-008, FR-009)
#
# Import this template in any slash-command `.md` file (Phases 2–4).
# Usage: add `imports: - src/.github/workflow-templates/phase-guard.md` to your `.md` frontmatter.

## Phase Guard Instructions

All phase AWs (plan.md, tasks.md, refine.md) fire on **spec PR comments**, not Feature Issue comments.
`github.event.issue.number` IS the PR number when a slash command fires on a PR comment.

Run all guards in order. Post the rejection comment and exit immediately on the first failure.

### 1. PR Context Guard (FR-007)

Call `get_pull_request(github.event.issue.number)`. If the call fails (404), the slash command
was issued on a regular issue. Post a rejection comment directing the user to post on the spec PR and exit.

### 2. PR Open Guard

If the PR `state` is not `open`, post a rejection comment and exit.

### 3. File-Existence Guard (FR-008)

List the `specs/` directory on the PR's `head.ref` branch to find the `{NNN}-{name}` subdirectory.
Check for the required artefact file(s):

- **`/approve-spec`** (plan.md): `specs/{dir}/spec.md` MUST exist; `plan.md` MUST NOT
- **`/approve-plan`** (tasks.md): `specs/{dir}/spec.md` AND `plan.md` MUST exist; `tasks.md` MUST NOT
- **`/refine-spec`** (refine.md): `specs/{dir}/spec.md` MUST exist; `plan.md` MUST NOT

If the required artefact is missing, post a rejection comment and exit.

### 4. Backward Command Guard (FR-009)

If artefacts beyond the target phase already exist (e.g., `plan.md` present when `/refine-spec` is issued,
or `tasks.md` present when `/approve-plan` is issued), post a rejection comment explaining the pipeline
state, identify which artefacts exist, and tell the user which command to use next. Exit immediately.

### 5. `[NEEDS CLARIFICATION]` Scan (FR-022, FR-023)

Read the key artefact (spec.md for /approve-spec; plan.md for /approve-plan) and scan for any
`[NEEDS CLARIFICATION:` substrings. If any are found:

1. Post a rejection comment on the **spec PR** identifying each unresolved marker.
2. **Exit immediately** — do NOT proceed with the phase.
