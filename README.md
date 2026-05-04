# agentic-flow

> From issue to PR — no standups required.

You open a GitHub issue. Agents triage, research, spec, plan, implement, and audit. You get a ready-to-merge PR.

agentic-flow is a drop-in framework that turns GitHub Copilot, GitHub Agentic Workflows, and [spec-kit](https://github.com/github/spec-kit) into a self-driving development pipeline. Agents handle the mechanical parts of the SDLC. You own the decisions.

> **Status:** Early development. Edge cases and hardening steps are still being worked out.

## Why

| You do | Agents do |
|--------|-----------|
| Open an issue | Triage, research, kick off spec |
| Answer clarifying questions | Write and refine the spec |
| `/approve-spec` | Write the implementation plan |
| `/approve-plan` | Break into tasks |
| Merge the spec PR | Implement tasks sequentially, audit, cross-cutting review |
| Review & merge the feature PR | — |

**Scales without headcount.** Multiple features run in parallel — each on its own branch and task queue. Tasks within a feature are sequential so agents always work on the latest state, no merge conflicts.

**Keeps token costs low.** Agents work from a human-approved spec, not open-ended prompts. Each task agent is scoped to one task on one branch. **Human gates act as circuit breakers** — you approve direction at each phase before agents spend tokens on the next one.

## Get Started

1. Download the latest release and extract it at your repository root.
2. Follow the setup guide in [`docs/README.md`](docs/README.md).
3. Open a GitHub issue. The pipeline starts automatically.

## Contributing

Contributions go through the same pipeline — agentic-flow is its own first user.

See [`docs/contributing.md`](docs/contributing.md) for the contribution workflow.
