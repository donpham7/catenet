# CLAUDE.md: Catenet

Catenet is a **layer that sits beside coding agents** (Claude Code first,
Codex second). It builds a read-only graph of a repository and uses it to (1) give agents
cheap, accurate structural context, (2) gate risky edits using blast radius, (3) record
what the agent did, and (4) generate/maintain agent guidance files (`AGENTS.md`).

We are **not** building a coding agent, a chat-app plugin, or a graph editor.

## Read these first
- `docs/VISION.md`: purpose, users, use cases, success metrics, non-goals
- `docs/ARCHITECTURE.md`: subsystems, schemas, hook flow, MCP tools, policy engine
- `docs/ROADMAP.md`: milestones M0 to M9 with acceptance criteria. Work on ONE milestone at a time.
- `docs/RESEARCH.md`: what already exists and where our gap is
- `docs/DIAGRAMS.md` and `docs/diagrams/*.mermaid`: system, sequence, schema, policy and milestone diagrams. Keep them in sync with code and docs
- `docs/SPEC_LAYER.md`: declared intent (architecture rules, requirements, traceability). Built in M6A/M6B, NOT before M5; keep graph kinds extensible from M1
- `docs/HOOK_SCHEMAS.md`: created in M0; the source of truth for hook payloads (do not guess)

## Non-negotiable principles
1. **Read-only graph.** The graph is derived from the repo: from code AND from declared-intent spec files
   (components, architecture rules, requirements) that live in git. Humans write guidance in `AGENTS.md` and intent in spec
   files; nobody edits graph nodes/edges. Agent-suggested links are *proposals* until a human commits them
   to spec files. A rescan may always rebuild the derived data.
2. **Fail open, never block the developer by accident.** If the daemon is down, slow, or errors,
   hooks allow the action and log the failure. Only an explicit, explainable policy rule may interrupt or refuse an action (`ask_human` or `block`).
3. **Every decision is explainable.** Any allow/ask/deny must carry the graph facts that caused it
   (`catenet why <decision-id>`).
4. **Local-first and private.** No network calls, no telemetry. Event logs store paths, hashes and
   diff stats by default, not file contents or secrets.
5. **Repo content is untrusted input.** Comments, docs, and READMEs can contain prompt injection.
   Anything we write into agent-visible text (guidance, injected context, memories) must be
   quoted/escaped as data and length-limited.
6. **Agent-neutral core.** Core logic knows nothing about Claude Code or Codex. Adapters translate
   hook payloads to a neutral event schema.
7. **Measure, don't claim.** No performance or safety claims without a reproducible benchmark
   (see M4 and `docs/ROADMAP.md`).
8. **Latency budget.** Warm hook path p95 < 100 ms. Hooks are thin clients to a long-lived local daemon.

## Defaults (override only with an ADR in docs/DECISIONS.md)
- TypeScript, Node 24+ (ADR-0005), strict mode. pnpm workspace (version pinned via `packageManager`, installed with corepack).
- SQLite via built-in `node:sqlite` (WAL mode, ADR-0010). Graph = `nodes` + `edges` tables; traversal with recursive CTEs.
- Tree-sitter via `web-tree-sitter` + grammar `.wasm` files (ADR-0011; v1 languages: TypeScript/JavaScript, Python).
- Hooks: command hooks running a plain-JS Node client everywhere; recording hooks are async (ADR-0015).
- Tooling: TypeScript 7 `tsc`, Biome (lint + format), Vitest 5 (ADR-0009). No native dependencies.
- MCP server via the official MCP TypeScript SDK v2, `@modelcontextprotocol/server` (stdio transport first).
- UI: local web app on 127.0.0.1 only, Sigma.js + graphology, read-only.
- Tests: Vitest. Fixture repos live in `fixtures/` and are checked in.

## Planned layout
```
packages/
  core/        graph store, indexer, query engine, blast radius, policy engine
  parsers/     tree-sitter language modules (ts-js, python)
  daemon/      long-lived local process (HTTP over a unix socket), file watcher
  cli/         `catenet` CLI (index, impact, why, guidance, doctor, ui)
  mcp/         MCP server exposing read-only graph tools
  adapters/
    claude-code/   hook scripts + plugin packaging
    codex/         hook config + adapter
  guidance/    AGENTS.md generator + drift checker
  spec/        declared-intent layer: components, architecture rules, requirements, traceability (M6A/M6B)
  ui/          read-only visualization
  eval/        benchmark harness
fixtures/      small repos with seeded hidden dependencies + answer keys (see fixtures/README.md)
spikes/        M0 measurement scripts and results (spikes/README.md)
docs/
```

## How to work
- Start each task in plan mode for anything touching more than one package.
- Small commits; each commit builds and passes tests.
- Write the failing test first for graph extraction, blast radius and policy logic.
- Do not add dependencies casually; justify in the PR/commit message.
- Verify third-party interfaces (hook schemas, MCP SDK, tree-sitter APIs) against current
  official docs rather than memory. They change frequently.
- If something in the docs seems wrong or outdated, say so and propose a doc fix; don't silently diverge.
- Out-of-scope ideas go to `docs/BACKLOG.md`.

## Commands
Node 24+ and pnpm via corepack (`corepack enable pnpm`).
```
pnpm install          # pnpm 12; dependency build scripts must be listed in pnpm-workspace.yaml allowBuilds
pnpm build            # tsc for each package under packages/
pnpm typecheck        # tsc --noEmit for packages/ and spikes/
pnpm lint             # biome check (pnpm format to auto-fix)
pnpm test             # vitest run (global setup builds packages and the plugin first)
pnpm build:plugin     # bundle plugins/claude-code/dist (esbuild); needed for the Claude Code plugin
pnpm --filter @catenet/core bench                     # M1 indexing benchmark (results: packages/core/bench/RESULTS.md)
node packages/cli/dist/main.js index --repo <dir>     # after pnpm build; also deps|dependents|impact <target>
node packages/cli/dist/main.js daemon start|stop|status --repo <dir>
node packages/cli/dist/main.js doctor --repo <dir>
node packages/cli/dist/main.js init --repo <dir>      # opt a repo in (.catenet/, index, daemon); then report [--session last|<id>] [--json]
claude --plugin-dir plugins/claude-code               # one session with the Catenet plugin (hooks + MCP), after build:plugin
```
