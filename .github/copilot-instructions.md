# agentic-flow Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-06

## Active Technologies
- GitHub Actions YAML + Markdown (gh-aw agentic workflows, compiler v0.66.1) + `gh aw` (GitHub Agentic Workflows CLI), GitHub MCP server, GitHub API event model (004-pr-slash-commands)
- N/A — GitHub API is the source of truth; no persistent storage (004-pr-slash-commands)

- YAML (GitHub Actions workflows), Markdown (agent instruction files), Python 3.x (inline validation script in post-merge.yml), JavaScript (github-script in post-merge.yml) + GitHub Actions, GitHub Copilot Agentic Workflows (`.aw.md`), `actions/github-script@v8`, `js-yaml@4.1.0` (001-remove-issue-types)

## Project Structure

```text
src/
tests/
```

## Commands

cd src [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] pytest [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] ruff check .

## Code Style

YAML (GitHub Actions workflows), Markdown (agent instruction files), Python 3.x (inline validation script in post-merge.yml), JavaScript (github-script in post-merge.yml): Follow standard conventions

## Recent Changes
- 004-pr-slash-commands: Added GitHub Actions YAML + Markdown (gh-aw agentic workflows, compiler v0.66.1) + `gh aw` (GitHub Agentic Workflows CLI), GitHub MCP server, GitHub API event model

- 001-remove-issue-types: Added YAML (GitHub Actions workflows), Markdown (agent instruction files), Python 3.x (inline validation script in post-merge.yml), JavaScript (github-script in post-merge.yml) + GitHub Actions, GitHub Copilot Agentic Workflows (`.aw.md`), `actions/github-script@v8`, `js-yaml@4.1.0`

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
