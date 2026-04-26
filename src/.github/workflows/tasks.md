---
name: Tasks Agent (agentic-flow)
on:
  slash_command: approve-plan

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  report-failure-as-issue: false
  add-comment: null
  add-labels:
    target: "*"
    allowed: [ready-to-merge]
  jobs:
    assign-tasks-agent-workaround:
      description: Assign the triggering spec PR to the agentic-flow-tasks wrapper and post the generated startup comment.
      output: Tasks agent assignment requested.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        contents: read
        pull-requests: write
      inputs:
        pull_number:
          description: String form of the spec PR number that received /approve-plan. Must match the triggering PR.
          required: true
          type: string
        feature_issue_number:
          description: Numeric feature issue number extracted from the handoff context block.
          required: true
          type: string
        spec_directory:
          description: Spec directory extracted from the handoff context block.
          required: true
          type: string
      steps:
        - name: Checkout repository
          uses: actions/checkout@v4
        - name: Assign agentic-flow-tasks wrapper
          uses: ./.github/actions/assign-pr-agent
          with:
            stage-name: tasks
            agent-name: agentic-flow-tasks
            agent-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
            speckit-phase-agent: .github/agents/speckit.tasks.agent.md

concurrency:
  group: tasks-pr-${{ github.event.issue.number }}
  cancel-in-progress: false

network:
  allowed:
    - defaults

env:
  COPILOT_MODEL: claude-sonnet-4-6

mcp-servers:
  github:
    type: http
    url: https://api.githubcopilot.com/mcp/
    headers:
      Authorization: "Bearer ${{ github.token }}"
---

You are the tasks agent for the agentic-flow pipeline. You have been triggered by `/approve-plan` on PR #${{ github.event.issue.number }}. Follow these instructions exactly.

## Phase Guard

Run all six guards in order. Post the rejection comment and exit immediately on the first failure.

### 1. PR Context Guard

Call `get_pull_request(${{ github.event.issue.number }})`.

If the call fails (the number is not a PR), post:
```markdown
## ❌ Wrong Location

`/approve-plan` must be posted as a comment on the spec PR, not on a Feature Issue.

Find your open spec PR and post `/approve-plan` there.
```
Exit immediately.

### 2. PR Open Guard

If the PR `state` is not `open`, post:
```markdown
## ❌ PR is Closed

This spec PR is closed or merged. No action taken.
```
Exit immediately.

### 3. Context Handoff Guard

Work through the following layers in order, stopping as soon as values are found.

**Layer 1 — Trusted Copilot comment**

Find the most recent PR comment containing `<!-- agentic-flow-context` authored by a trusted Copilot login (`copilot`, `copilot[bot]`, `copilot-swe-agent`, `copilot-swe-agent[bot]`). Extract `Feature issue: #N` and `Spec directory: specs/{NNN}-{name}`. If found → proceed.

**Layer 2 — Pipeline startup comment**

If Layer 1 fails, find the most recent PR comment that contains **both** `<!-- agentic-flow-context` and `## Plan Agent — Startup Instructions`, **and** the body contains `Phase: plan`. These comments are generated exclusively by the agentic-flow plan workaround action and carry transitively trusted values (they were constructed from the previous Guard 3's already-validated context). Extract `Feature issue` and `Spec directory`. If found → proceed without any warning.

**Layer 3 — Fallback reconstruction**

If Layers 1 and 2 both fail, attempt to infer the values from workflow-owned metadata:

- **Spec directory**: Call `get_pull_request_files` on this PR. Collect all changed file paths and extract every unique `specs/{NNN}-{name}/` directory prefix (any file under a `specs/` subdirectory counts — `spec.md`, `plan.md`, etc.). If exactly **one** unique directory prefix is found, use it. If zero or more than one are found, skip to the failure block below.
- **Feature issue**: Read the PR body for issue-closing keywords (`Closes #N`, `Fixes #N`, `Resolves #N`). For each referenced issue, call `get_issue`. Check whether the issue body contains `<!-- agentic-flow-context` and extract `Feature issue: #M` from it. Also accept issues whose title begins with `Spec/Plan/Tasks:` as candidates. If exactly **one** candidate yields an unambiguous feature issue number, use it.

If both values were found, post a warning comment and proceed (reconstructed values flow into `assign_tasks_agent_workaround`):
```markdown
⚠️ **Context Reconstructed**

The `agentic-flow-context` handoff comment was not found on this PR. The required values were
inferred from PR file changes and linked issue metadata:

- Spec directory: `{spec_directory}`
- Feature issue: #{feature_issue_number}

The tasks agent will now run and will re-post a proper handoff comment when it finishes.
```

**Failure**

If all three layers fail, post:
```markdown
## ❌ Context Not Found

The tasks phase could not locate a handoff context on this PR, and automatic reconstruction failed.

**What was attempted:**
- Layer 1: no trusted Copilot comment with `agentic-flow-context` found
- Layer 2: no plan agent startup comment found
- Layer 3 — PR file scan for spec directory: {result}
- Layer 3 — Linked issue scan for feature issue number: {result}

**Recovery:** Check the Actions tab for the most recent plan or spec agent run. Use `/approve-spec`
to re-run the plan stage if `plan.md` is already present and correct.
```
Exit immediately.

### 4. `plan.md` Existence Guard

Call `get_file_contents("{spec_dir}/plan.md", head.ref)`.

If the file does not exist (404), post:
```markdown
## ❌ Plan Not Found

`plan.md` is not present on this PR's head branch. Use `/approve-spec` to generate the plan first.
```
Exit immediately.

### 5. `tasks.md` Idempotency Guard

Check `{spec_dir}/tasks.md` on `head.ref`.

If `tasks.md` already exists, post:
```markdown
## ℹ️ Tasks Already Generated

`tasks.md` already exists on this branch. Review `tasks.md` and merge the PR when satisfied.
```
Exit.

### 6. `[NEEDS CLARIFICATION]` Scan

Read `{spec_dir}/plan.md` content. Scan for any `[NEEDS CLARIFICATION:` substrings.

If any are found, post:
```markdown
## ❌ Unresolved Clarification Markers

The following `[NEEDS CLARIFICATION:]` markers were found in `plan.md` and must be resolved before the tasks phase can proceed:

{list each marker with surrounding context}

Please resolve these markers in this PR, commit the changes, and then re-issue `/approve-plan`.
```
Exit immediately.

## Step 1 — Invoke agentic-flow-tasks

The spec PR is `#${{ github.event.issue.number }}` — this is the PR on which `/approve-plan` was received. Use its number directly.

Use the `feature_issue_number` and `spec_directory` values already resolved by the **Context Handoff Guard** above. Do not re-read PR comments here — use the values in hand.

1. Call the `assign_tasks_agent_workaround` safe-output with:
   - `pull_number`: the numeric triggering spec PR number from the GitHub context (digits only, for example `25`)
   - `feature_issue_number`: the numeric feature issue number extracted from the latest context block (digits only, for example `10`)
   - `spec_directory`: the exact spec directory extracted from the latest context block (for example `specs/001-tic-tac-toe`)

   The assignment workaround will build the exact startup comment body itself, including a direct natural-language `@copilot` request and the hidden `agentic-flow-context` block, then post that generated comment after assigning the custom agent.

   Note: the current built-in `assign_to_agent` PR path is internally inconsistent: the tool schema accepts `pull_number`, but the explicit PR target resolver later expects `pull_request_number`, which causes the built-in assignment step to fail.
   Also note: on existing PRs, reassignment alone did not reliably start work in testing, so this workflow posts the `@copilot` trigger comment after assigning the custom agent.

**Do NOT post any other comment.** The 👁️ reaction from the slash command is sufficient. Only post on error (see Error Handling below).

## Error Handling

If any step fails unexpectedly, use `create_issue_comment` to post the following comment on spec PR `#${{ github.event.issue.number }}`:
```markdown
## ❌ Tasks Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-issue `/approve-plan` on this spec PR to retry tasks generation.

_Automated recovery comment — agentic-flow_
```
Ensure the workflow exits with a clear error state.
