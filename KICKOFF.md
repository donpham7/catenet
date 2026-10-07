# Kickoff: how to use this brief with Claude Code

"Catenet" is the chosen name (from "concatenated network"). As of 2026-10-03, bare `catenet` was free on npm and PyPI; GitHub org/handle, domains and trademarks were NOT verified. Confirm before publishing.

## Setup (5 minutes)

1. Create an empty repo and `cd` into it.
2. Copy this bundle in so the layout is:
   ```
   CLAUDE.md                 <- repo instructions Claude Code reads every session
   docs/VISION.md            <- why, who, use cases, success metrics
   docs/ARCHITECTURE.md      <- design, schemas, hooks, MCP tools, policy engine
   docs/ROADMAP.md           <- milestones with acceptance criteria, eval plan, open questions
   docs/RESEARCH.md          <- competitive landscape and the gaps (with caveats)
   docs/SPEC_LAYER.md        <- architecture + requirements (SRS) baked into the graph (built later, M6A/M6B)
   docs/DIAGRAMS.md          <- Mermaid diagrams (sources in docs/diagrams/*.mermaid)
   ```
3. Run `claude` in the repo root.

## First prompt (paste this)

```
Read CLAUDE.md, then docs/VISION.md, docs/ARCHITECTURE.md, docs/ROADMAP.md,
docs/RESEARCH.md and docs/SPEC_LAYER.md in full.

We are building Catenet: a read-only code graph + safety gate + observability layer
that plugs into Claude Code and Codex via MCP and hooks. We are NOT building an agent. The spec layer (architecture rules + requirements) is designed now
but built in M6A/M6B; just keep node/edge kinds extensible.

Start with Milestone M0 only. Use plan mode first. Before writing code:
1. Fetch the CURRENT official hook documentation for Claude Code and Codex CLI and
   record the exact payload/response schemas in docs/HOOK_SCHEMAS.md. Do not rely on
   the examples in our docs; they may be out of date.
2. List the decisions you need from me (language/runtime, license, project name,
   package layout) with your recommendation for each, and ask me before proceeding.
3. Propose the repo skeleton and the fixture repos for testing.

Stop after M0 and wait for my review. Do not start M1.
```

## Working agreements to restate when needed

- One milestone at a time; stop for review at each milestone boundary.
- Tests before or alongside every graph/policy change; the eval harness (M4) is not optional.
- Record every non-obvious decision in `docs/DECISIONS.md` (short ADR entries).
- When a doc and reality disagree, update the doc in the same change.
- Anything that would expand scope (graph editing, chat-app support, cloud sync) goes into
  `docs/BACKLOG.md`, not into the current milestone.

## Decisions only you can make (Claude Code will ask)

| Decision | Recommendation in docs | Why it matters |
|---|---|---|
| Project name | "Catenet" (chosen; verify handle/domain/trademark before publishing) | Package names, CLI name (`catenet`), namespace |
| Language/runtime | TypeScript on Node 24+ (ADR-0005; Node 20 is end-of-life) | One language for core, MCP server, and UI; easy `npx` install |
| License | MIT (ADR-0006) | Adoption vs patent clarity |
| Distribution | npm package + Claude Code plugin | Reach |
| Telemetry | None | Trust; local-first is part of the pitch |
