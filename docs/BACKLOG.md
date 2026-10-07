# Backlog

Out-of-scope ideas, parked so they don't leak into the current milestone (CLAUDE.md "How to work"). Moving an item into
a milestone needs an ADR or a ROADMAP change reviewed by the owner.

## Product
- Graph editing (UI or chat). Conflicts with the read-only graph principle; listed only so it isn't re-proposed.
- Chat-app plugin (ChatGPT / Claude.ai have no hooks; needs a hosted remote MCP mode).
- Cloud sync / teams dashboard.
- Signed / tamper-evident audit log. world-model-mcp already ships one; evaluate demand first.
- Requirement quality analysis (contradiction / SMT-style checking) and any spec-authoring workflow. Use Spec Kit, Kiro or
  OpenSpec; Catenet ingests their output.

## Analysis
- More languages: Go, Java, Rust, C#. Go is the cheapest (trivial import resolution) and would be needed first if Catenet
  ever adds a Go component and keeps tracking its own repo.
- Cross-language edges.
- Compiler-accurate references via SCIP indexers (scip-typescript, scip-python) as an optional accuracy boost on top of
  tree-sitter.
- Method calls on class instances (`const w = new Widget(); w.render()` -> `Widget.render`). Needs type inference;
  name-only matching would create false edges and gate noise. File-level dependency on the class is already captured
  through the constructor call. Candidate implementation: SCIP or the TypeScript API once TS 7.1 ships one.
- Implicit Python parent-package imports (`import a.b.c` also runs `a/__init__.py`, `a/b/__init__.py`). Real runtime
  coupling, but counting it would make every package `__init__.py` a hub. If wanted, add it as a separate weak edge
  kind that is excluded from blast-radius counts.

## Visualization
- Run comparison UI (Claude Code vs Codex), session timeline / replay, memory view, hotspot treemap.

## CI
- CI integrations beyond `catenet guidance --check` and `catenet spec check`.
