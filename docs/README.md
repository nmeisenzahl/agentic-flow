# agentic-flow

**Spec-driven development automation for GitHub.** Every feature follows a fixed pipeline from issue triage through to task sub-issues — fully automated, with exactly four human touchpoints.

## What It Does

agentic-flow automates specification and planning for every feature:

1. **Triage** — Formats and classifies every new Feature issue
2. **Research** — Enriches the issue with domain research and prior art
3. **Spec** — Generates `spec.md` via the speckit quality gate chain
4. **Plan** — Generates `plan.md` with architecture decisions
5. **Tasks** — Generates `tasks.md` with dependency graph
6. **Post-merge** — Creates Task sub-issues linked to the Feature issue
7. **Implementation** — Triggered automatically by the `tasks-created` label. Creates a feature branch, opens a draft PR, and dispatches `agentic-flow-implement` for each task sub-issue in dependency order. Each task gets its own branch and auto-merging task PR targeting the feature branch.
8. **Audit** — Once all implementation tasks are merged, dispatches `agentic-flow-audit` to review the complete feature branch diff against each audit task sub-issue. Audit agents post formal PR reviews and close audit issues.
9. **Human Merge** — After all audits pass, the feature PR is marked ready for human review. A human reviews and merges the feature PR to `main`, closing the feature issue.

## Getting Started

1. Download `agentic-flow-v{version}.zip` from the [latest release](https://github.com/nmeisenzahl/agentic-flow/releases/latest)
2. Extract into your repository root:
   ```bash
   unzip agentic-flow-v{version}.zip
   ```
3. Install the `gh aw` CLI extension and compile the agentic workflow lock files (not shipped in the zip):
   ```bash
   gh extension install github/gh-aw
   gh aw compile .github/workflows/*.md
   ```
4. Commit the agentic-flow files:
   ```bash
   git add .github/
   git commit -m "feat: add agentic-flow pipeline"
   git push
   ```
5. Install spec-kit and initialize it in your repository — the wrapper agents read spec-kit phase/gate docs from `.github/agents/`:
   ```bash
   uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
   specify init . --ai copilot
   ```
   Verify these files exist after `specify init`:
   - `.github/agents/speckit.specify.agent.md`
   - `.github/agents/speckit.plan.agent.md`
   - `.github/agents/speckit.tasks.agent.md`
   - `.github/agents/speckit.clarify.agent.md`
   - `.github/agents/speckit.checklist.agent.md`
   - `.github/agents/speckit.analyze.agent.md`
6. Commit the spec-kit files:
   ```bash
   git add .
   git commit -m "chore: initialize spec-kit"
   git push
   ```
7. Complete GitHub settings — see **[docs/init.md](init.md)** for the full setup walkthrough
8. Open a test issue to verify triage fires

> **Upgrading?** Extracting a newer zip overwrites all framework files in `.github/agents/` and `.github/workflows/`. Back up any customisations before upgrading. See [docs/init.md § Upgrading](init.md#7-upgrading) for full instructions.

## Documentation

| File | Contents |
|------|----------|
| [docs/init.md](init.md) | Full setup guide: GitHub settings, MCP config, labels, secrets |
| [docs/usage.md](usage.md) | Slash commands, pipeline overview, configuration reference, troubleshooting |
