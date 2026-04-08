# agentic-flow

**Spec-driven development automation for GitHub.** Every feature follows a fixed pipeline from issue triage through to task sub-issues — fully automated, with exactly four human touchpoints.

## What It Does

agentic-flow automates specification and planning for every feature:

1. **Triage** — Formats and classifies every new Feature issue
2. **Research** — Enriches the issue with domain research and prior art
3. **Spec** — Generates `spec.md` via the speckit quality gate chain
4. **Plan** — Generates `plan.md` with architecture decisions
5. **Tasks** — Generates `tasks.md` with dependency graph; applies `ready-to-merge`
6. **Post-merge** — Creates Task sub-issues linked to the Feature issue

## Getting Started

1. Download `agentic-flow-v{version}.zip` from the [latest release](https://github.com/nicholasgasior/agentic-flow/releases/latest)
2. Extract into your repository root:
   ```bash
   unzip agentic-flow-v{version}.zip
   ```
3. Compile the agentic workflow lock files (not shipped in the zip):
   ```bash
   gh aw compile .github/workflows/*.md
   ```
4. Commit everything:
   ```bash
   git add .github/
   git commit -m "feat: add agentic-flow pipeline"
   git push
   ```
5. Complete GitHub settings — see **[docs/init.md](init.md)** for the full setup walkthrough
6. Open a test issue to verify triage fires

`specify init . --ai copilot` is part of the setup because agentic-flow's shipped wrapper agents (`agentic-flow-spec`, `agentic-flow-plan`, `agentic-flow-tasks`) read the speckit phase/gate docs that `specify init` installs into `.github/agents/`.

> **Upgrading?** Extracting a newer zip overwrites all framework files in `.github/agents/` and `.github/workflows/`. Back up any customisations before upgrading. See [docs/init.md § Upgrading](init.md#9-upgrading) for full instructions.

## Documentation

| File | Contents |
|------|----------|
| [docs/init.md](init.md) | Full setup guide: GitHub settings, MCP config, labels, secrets |
| [docs/usage.md](usage.md) | Slash commands, pipeline overview, configuration reference, troubleshooting |
