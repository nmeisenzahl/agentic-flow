# agentic-flow

> Spec-driven development, fully automated — from raw idea to merged pull request.

agentic-flow is a drop-in framework for GitHub repositories that turns GitHub Copilot, GitHub Actions, and [spec-kit](https://github.com/github/spec-kit) into a self-driving development pipeline. You open an issue. Agents triage, research, spec, plan, and break it into tasks — with human approval gates at each phase transition.

```
Issue → Triage → Research → Spec → Plan → Tasks → [Implementation → Review → Merge]
```

> `[…]` = planned future phases, not yet implemented.

No context-switching. No ticket grooming. Just ship.

> **Status:** Early development. Edge cases and hardening steps are still being worked out.

## Why

Software teams spend more time coordinating work than doing it. agentic-flow removes that overhead: agents handle the mechanical parts of the SDLC (structuring requirements, writing specs, creating tasks, reviewing code) while humans focus on intent and decisions.

## Usage

1. Download the latest release and extract it at your repository root.
2. Follow the setup guide in [`docs/README.md`](docs/README.md).
3. Open a GitHub issue. The pipeline starts automatically.

Human gates: answer clarifying questions → `/approve-spec` → `/approve-plan` → merge the spec PR. Everything else in the active phases is automated.

Humans can jump in at any stage — comment on the spec PR, open a GitHub Codespace, work locally, or invoke agents and spec-kit commands directly. The pipeline picks up where you leave off.

In adopter repos, `specify init . --ai copilot` provides the speckit phase/gate agents in `.github/agents/`. agentic-flow adds three wrapper agents — `agentic-flow-spec`, `agentic-flow-plan`, and `agentic-flow-tasks` — that keep the speckit flow on the already-assigned issue/PR branch instead of creating extra branches or PRs.

## Pipeline at a glance

- **Issue** — A feature request is opened.
- **Triage** — The request is normalized and labeled for next action.
- **Research** — Background findings are added to reduce ambiguity.
- **Spec** — A formal spec is generated and reviewed.
- **Plan** — Implementation approach is defined from the approved spec.
- **Tasks** — Work is split into executable task issues.
- **[Implementation]** — *(future)* Agents implement tasks in draft PRs.
- **[Review]** — *(future)* Security, architecture, acceptance criteria, and coverage checks run.
- **[Merge]** — *(future)* PR is reviewed and merged once all gates pass.

## Contributing

Contributions go through the same pipeline — agentic-flow is its own first user.

See [`docs/contributing.md`](docs/contributing.md) for the contribution workflow, the `src/` / dev separation, and the release process.
