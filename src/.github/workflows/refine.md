---
name: Refine Spec Agent (agentic-flow)
on:
  slash_command: refine-spec

permissions:
  issues: read
  pull-requests: read
  contents: read

safe-outputs:
  report-failure-as-issue: false
  add-comment: null
  jobs:
    assign-refine-agent-workaround:
      description: Assign the triggering spec PR to the agentic-flow-spec wrapper in refine mode and post the generated startup comment.
      output: Refine agent assignment requested.
      runs-on: ubuntu-latest
      needs: safe_outputs
      permissions:
        contents: read
        pull-requests: write
      inputs:
        pull_number:
          description: String form of the spec PR number that received /refine-spec. Must match the triggering PR.
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
          uses: actions/checkout@v6
        - name: Assign agentic-flow-spec wrapper (refine mode)
          uses: ./.github/actions/assign-pr-agent
          with:
            stage-name: refine
            agent-name: agentic-flow-spec
            agent-token: ${{ secrets.GH_AW_AGENT_TOKEN }}
            speckit-phase-agent: .github/agents/speckit.specify.agent.md

concurrency:
  group: refine-pr-${{ github.event.issue.number }}
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

# Refine Spec Agent

You are the refine-spec agent for the agentic-flow pipeline. You have been triggered by `/refine-spec` on PR #${{ github.event.issue.number }}. Follow these instructions exactly.

## Phase Guard

Run all five guards in order. Post the rejection comment and exit immediately on the first failure.

### 1. PR Context Guard

Call `get_pull_request(${{ github.event.issue.number }})`.

If the call fails (the number is not a PR), post:
```markdown
## ❌ Wrong Location

`/refine-spec` must be posted as a comment on the spec PR, not on a Feature Issue.

Find your open spec PR and post `/refine-spec` there.
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

If Layer 1 fails, find the most recent PR comment that contains **both** `<!-- agentic-flow-context` and `## Refine Spec Agent — Startup Instructions` (or `## Spec Agent — Startup Instructions`), **and** the body contains `Phase: spec`. These comments are generated exclusively by the agentic-flow refine/spec workaround action and carry transitively trusted values (they were constructed from the previous Guard 3's already-validated context). Extract `Feature issue` and `Spec directory`. If found → proceed without any warning.

**Layer 3 — Fallback reconstruction**

If Layers 1 and 2 both fail, attempt to infer the values from workflow-owned metadata:

- **Spec directory**: Call `get_pull_request_files` on this PR. Collect all changed file paths and extract every unique `specs/{NNN}-{name}/` directory prefix. If exactly **one** unique directory prefix is found, use it. If zero or more than one are found, skip to the failure block below.
- **Feature issue**: Read the PR body for issue-closing keywords (`Closes #N`, `Fixes #N`, `Resolves #N`). For each referenced issue, call `get_issue`. Check whether the issue body contains `<!-- agentic-flow-context` and extract `Feature issue: #M` from it. Also accept issues whose title begins with `Spec/Plan/Tasks:` as candidates. If exactly **one** candidate yields an unambiguous feature issue number, use it.

If both values were found, post a warning comment and proceed (reconstructed values flow into `assign_refine_agent_workaround`):
```markdown
⚠️ **Context Reconstructed**

The `agentic-flow-context` handoff comment was not found on this PR. The required values were
inferred from PR file changes and linked issue metadata:

- Spec directory: `{spec_directory}`
- Feature issue: #{feature_issue_number}

The refine agent will now run and will re-post a proper handoff comment when it finishes.
```

**Failure**

If all three layers fail, post:
```markdown
## ❌ Context Not Found

The refine phase could not locate a handoff context on this PR, and automatic reconstruction failed.

**What was attempted:**
- Layer 1: no trusted Copilot comment with `agentic-flow-context` found
- Layer 2: no spec/refine agent startup comment found
- Layer 3 — PR file scan for spec directory: {result}
- Layer 3 — Linked issue scan for feature issue number: {result}

**Recovery:** Check the Actions tab for the most recent spec agent run. If the spec branch and
files look correct, a repository maintainer may need to re-trigger the spec agent manually.
```
Exit immediately.

### 4. `spec.md` Existence Guard

Call `get_file_contents("{spec_dir}/spec.md", head.ref)`.

If the file does not exist (404), post:
```markdown
## ❌ Spec Not Found

`spec.md` is not present on this PR's head branch. The spec phase has not completed.
```
Exit immediately.

### 5. Backward Command Guard

Check `{spec_dir}/plan.md` on `head.ref`. If the file **exists**, post:
```markdown
## ❌ Too Late for Refinement

`/refine-spec` can only be used while the spec is still open (before `/approve-spec` is run).

`plan.md` already exists on this branch, meaning the plan phase has already started.

Use `/approve-plan` if the plan is ready, or open a new spec PR if you need to iterate further.
```
Exit immediately.

## Step 1 — Invoke agentic-flow-spec

The spec PR is `#${{ github.event.issue.number }}` — this is the PR on which `/refine-spec` was received. Use its number directly.

Use the `feature_issue_number` and `spec_directory` values already resolved by the **Context Handoff Guard** above. Do not re-read PR comments here — use the values in hand.

1. Call the `assign_refine_agent_workaround` safe-output with:
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
## ❌ Refine Spec Agent — Error

**Step**: {step that failed}
**Error**: {error message}

**Recovery**: Re-issue `/refine-spec` on this spec PR to retry spec refinement.

_Automated recovery comment — agentic-flow_
```
Ensure the workflow exits with a clear error state.
