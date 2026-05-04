# agentic-flow — Framework Init Guide

This document covers everything required to set up agentic-flow in a new repository: GitHub account requirements, repository settings, MCP server configuration, and branch protection rules.

---

## 1. GitHub Account Requirements

| Requirement | Why |
|-------------|-----|
| **GitHub Copilot Enterprise** (or Copilot Business + coding agent access) | Required for Copilot cloud agents (`.agent.md` files) |
| **Copilot coding agent enabled** for the organization | Agents must be able to open PRs and run in the repo context |
| **GitHub Actions enabled** | All workflow automation runs via Actions |
| **Sub-issues API access** | Task issues linked as sub-issues under Feature issues (requires GitHub Issues beta features) |

---

## 2. Repository Settings

### General

- **Default branch:** `main`
- **Merge strategy:** Squash merge only (disable merge commits and rebase merge)
- **Automatically delete head branches:** enabled

### Issues

- Enable **Sub-issues** (beta): required for parent Feature → child Task linking

### Labels

Create the following labels before first use:

| Label | Color | Purpose |
|-------|-------|---------|
| `needs-spec` | `#0075ca` | Issue is ready for spec phase |
| `needs-refinement` | `#e4e669` | Issue needs more detail before spec |
| `research-in-progress` | `#f9d0c4` | Research agent is running |
| `research-complete` | `#0e8a16` | Research findings appended; ready for spec |
| `spec-in-progress` | `#d93f0b` | Spec is being authored |
| `ready-to-merge` | `#0e8a16` | Applied automatically by `agentic-flow-tasks` when analyze + checklist pass — merge the PR when ready |
| `tasks-created` | `#5319e7` | All task sub-issues created — triggers implementation pipeline |
| `agentic-flow-task` | `#0075ca` | Applied to every task sub-issue |
| `agentic-flow-audit` | `#e4e669` | Applied to audit/review task sub-issues |
| `implementing` | `#d93f0b` | Feature issue: implementation phase in progress |
| `implementation-complete` | `#0e8a16` | Feature issue: all tasks merged; audit phase |
| `agentic-flow-task-pr` | `#0075ca` | Applied to task PRs targeting the feature branch |
| `ready-to-merge-task` | `#0e8a16` | Agent signals task PR is ready for auto-merge |

---

## 3. Copilot Coding Agent Settings

In **repository Settings → Copilot → Coding agent**:

- **Enable coding agent** for this repository
- **Allow agent to push to branches:** enabled (agents open PRs from spec branches)
- **Allow agent to create issues:** enabled (for `/taskstoissues`)
- **Firewall / allowed tools:** ensure `create_issue`, `add_sub_issue`, `create_or_update_file` are not blocked

### MCP Servers

The agentic-flow wrapper agents define their MCP server configuration directly in their YAML frontmatter (`mcp-servers:` property). This means the MCP config ships as code — no manual UI configuration is needed.

Each agent declares only the tools it requires (least privilege):

| Agent | Write tools | Label tools |
|-------|------------|-------------|
| `agentic-flow-spec` | `create_or_update_file`, `create_issue_comment`, `create_pull_request_review` | — |
| `agentic-flow-plan` | `create_or_update_file`, `create_issue_comment`, `create_pull_request_review` | — |
| `agentic-flow-tasks` | `create_or_update_file`, `create_issue_comment`, `create_pull_request_review` | `issue_write` |
| `agentic-flow-implement` | `create_or_update_file`, `create_issue_comment` | `issue_write` |
| `agentic-flow-audit` | `create_issue_comment`, `create_pull_request_review` | `issue_write` |

All three agents connect to `https://api.githubcopilot.com/mcp/` using `COPILOT_MCP_GITHUB_WRITE_TOKEN` from the `copilot` environment (see §5b).

> **Important:** If you previously configured a GitHub MCP server in the repository UI (Settings → Copilot → Cloud agent), **remove it** after deploying these agents. Repo-level MCP config merges with agent-level config and would grant tools beyond each agent's least-privilege set.

#### Microsoft Docs MCP Server (optional)

Required by: the agentic-flow research agent (`research.md`) for technology reference lookups

```json
{
  "mcpServers": {
    "microsoft-docs": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    }
  }
}
```

Used for: surfacing relevant Microsoft/Azure documentation during research phase.

> **Note:** MCP server availability depends on your Copilot plan and organization policies. If a server is unavailable, the relevant agent degrades gracefully — research still runs using web search tools.

---

## 4. GitHub Actions Permissions

In **repository Settings → Actions → General**:

- **Workflow permissions:** Read and write permissions
- **Allow GitHub Actions to create and approve pull requests:** enabled
- **"Require approval for workflow runs":** disabled (agents run on demand via slash commands, so no need for manual workflow approvals)

The `GITHUB_TOKEN` used by workflows needs the following scopes at runtime (set via `permissions:` in each workflow file):

| Scope | Required by |
|-------|------------|
| `issues: write` | Triage workflow, post-merge workflow |
| `pull-requests: write` | All spec phase workflows |
| `contents: write` | Workflows that commit spec artifacts |
| `metadata: read` | All workflows (implicit) |

---

## 5. Required Secrets

### COPILOT_GITHUB_TOKEN

`COPILOT_GITHUB_TOKEN` is a fine-grained PAT used to authenticate GitHub Copilot engine calls inside every agentic workflow. The workflow validates this secret as its first step and exits immediately if not set.

**Create the token**:

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Scope the token to this repository
4. The account must have Copilot access; no repository permissions are required for this token (it is used only to call the Copilot API, not to read or write repository contents)

**Add to repository**:

1. Go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `COPILOT_GITHUB_TOKEN`
4. Value: the fine-grained PAT you just created

---

### GH_AW_AGENT_TOKEN

`GH_AW_AGENT_TOKEN` is a fine-grained PAT required by the custom PR assignment workaround used in `plan.md`, `refine.md`, `tasks.md`, `implement-dispatch.yml`, `audit-dispatch.yml`, `audit-chain-trigger.yml`, and `rerun-audit-trigger.yml`. Those workflows use it to reassign Copilot on the spec PR and post the startup `@copilot` comment that launches the wrapper agent. The `/start-spec` flow continues to use the built-in sub-issue assignment path. Without this secret, the PR-based wrapper handoff cannot launch.

This same token is also used as the underlying PAT for `COPILOT_MCP_GITHUB_WRITE_TOKEN` (see §5b).

**Create the token**:

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Scope the token to this repository
4. Grant **Repository permissions**: Actions (Write), Contents (Write), Issues (Write), Pull requests (Write), Workflows (Write)

> **Workflows permission is required.** `implement-trigger.yml` pushes the feature branch which contains `.github/workflows/` files. GitHub blocks any token — including GITHUB_TOKEN — from pushing branches that touch workflow files unless it explicitly has the `workflow` scope (classic PAT) or "Workflows: Read and write" (fine-grained PAT). Without this permission, feature branch creation fails with `refusing to allow a Personal Access Token to create or update workflow ... without workflow scope`.

**Add to repository**:

1. Go to **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `GH_AW_AGENT_TOKEN`
4. Value: the fine-grained PAT you just created

---

### 5b. Copilot Environment & Setup Steps

The Copilot coding agent uses a special `copilot` Actions environment. Secrets and variables added to this environment are available to the agent runtime and MCP server configurations — including the `mcp-servers:` blocks defined in agent YAML frontmatter.

#### Create the `copilot` environment

1. Go to **Settings → Environments**
2. Click **New environment**
3. Name: `copilot`
4. No deployment protection rules are needed

#### Add environment secrets

Add the following secret to the `copilot` environment:

| Secret | Value | Purpose |
|--------|-------|---------|
| `COPILOT_MCP_GITHUB_WRITE_TOKEN` | Same PAT as `GH_AW_AGENT_TOKEN` | Referenced by each wrapper agent's `mcp-servers:` frontmatter for `create_or_update_file`, labels, and other GitHub API operations |

> **Why a separate name?** GitHub requires MCP config variable references to start with `COPILOT_MCP_`. The underlying PAT is the same as `GH_AW_AGENT_TOKEN` and must be rotated together.

> **Why the `copilot` environment?** The `${{ secrets.COPILOT_MCP_* }}` syntax in agent YAML frontmatter resolves secrets from the `copilot` environment only — repo-level Action secrets are not available for MCP variable substitution.

#### Remove any repo-level MCP UI config

If you previously configured a GitHub MCP server in **Settings → Copilot → Cloud agent**, remove it. The wrapper agents now carry their own per-agent MCP config in YAML frontmatter. Leaving the repo-level config in place would merge additional tools into the agent's session, bypassing the per-agent least-privilege tool lists.

#### `copilot-setup-steps.yml`

The framework ships `copilot-setup-steps.yml` in `.github/workflows/`. This workflow runs automatically before every Copilot coding agent session. It is shipped as a ready-to-extend template — add your own setup steps (dependency installation, tool setup, etc.) as needed.

> **Note:** The wrapper agents commit via the `create_or_update_file` MCP tool (GitHub Contents API), not `git push`. The setup steps file does not need to inject write credentials — the MCP token handles write access.

---

## 6. Branch Protection Rules

On the `main` branch (Settings → Branches → Add rule):

- **Require a pull request before merging:** enabled
  - Require approvals: 0 for the feature branch (task PRs are auto-merged by the pipeline; the feature PR requires human approval before merging to `main`)
- **Require status checks to pass:** enabled
  - Add your CI check names once they exist
- **Require branches to be up to date:** enabled
- **Do not allow bypassing the above settings:** enabled (including admins)
- **Restrict who can push to matching branches:** enabled
  - Allow: the GitHub Actions bot (`github-actions[bot]`) for auto-merge

---

## 7. Agentic Workflows (`.md`)

agentic-flow uses GitHub Agentic Workflows for slash command routing. The release zip ships only the `.md` source files — **compiled `.lock.yml` files are not included**. You must compile them after installation.

1. **Install the `gh aw` CLI extension** on your machine:
   ```bash
   gh extension install github/gh-agentic-workflows
   ```
2. **Compile all agentic workflow sources** after extracting the zip:
   ```bash
   gh aw compile .github/workflows/*.md
   ```
3. **Commit the compiled outputs**:
   ```bash
   git add .github/workflows/*.lock.yml
   git commit -m "chore: compile agentic workflow lock files"
   git push
   ```

> Recompile and commit whenever you modify a `.md` workflow source.

---

## 8. spec-kit Installation

agentic-flow's wrapper agents read spec-kit phase/gate documents directly from `.github/agents/`. The target repository must have spec-kit initialized:

```bash
# Install spec-kit CLI
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git

# Initialize in the target repository
cd your-repo
specify init . --ai copilot
```

The `specify init` command copies spec-kit skill/template files into the repository, including the speckit phase and gate agents that agentic-flow expects to find in `.github/agents/`.

Verify these files exist after `specify init`:

- `.github/agents/speckit.specify.agent.md`
- `.github/agents/speckit.plan.agent.md`
- `.github/agents/speckit.tasks.agent.md`
- `.github/agents/speckit.clarify.agent.md`
- `.github/agents/speckit.checklist.agent.md`
- `.github/agents/speckit.analyze.agent.md`

agentic-flow ships only the wrapper agents. If these speckit files are missing, the wrapper agents cannot run.

---


## 9. Upgrading

To upgrade to a newer version of agentic-flow:

1. **Back up any customisations** — if you have modified files in `.github/agents/` or `.github/workflows/`, save them first
2. **Download the new zip** from the [latest release](https://github.com/nicholasgasior/agentic-flow/releases/latest)
3. **Extract over your existing installation**:
   ```bash
   unzip -o agentic-flow-v{new-version}.zip
   ```
    > **⚠️ Warning:** Extraction overwrites existing framework files. Any customisations to `.github/agents/` or `.github/workflows/` that exist in the zip will be replaced. Back up your changes before extracting.
4. **Delete stale legacy driver files** if present:
   ```bash
   rm -f .github/agents/speckit-driver.agent.md
   ```
   > Older installs keep this file after unzip because archive extraction overwrites files but does not remove ones that no longer ship.
5. **Restore customisations** from your backup if needed
6. **Recompile agentic workflows** (lock files are not shipped):
   ```bash
   gh aw compile .github/workflows/*.md
   ```
7. **Commit the updated files**:
   ```bash
   git add .github/
   git commit -m "chore: upgrade agentic-flow to v{new-version}"
   git push
   ```
