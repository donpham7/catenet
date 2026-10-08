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

- Symbol-level attribution for destructured dynamic imports (`const { f } = await import("./m")`). Today such an edge is
  file-level only, so a symbol target misses the file (eval-shop's `src/reports/daily.ts` for `formatPrice`; found in
  M4).

## Evaluation (after M4)
- Competitor comparison spike (deferred from M4 by the owner): install world-model-mcp, yigraf, codebase-memory-mcp,
  code-impact-mcp, Kontext; run their structural answers against our answer keys; record install friction, latency,
  misses and false positives (RESEARCH "M0/M4 validation tasks").
- Heuristic-edge tasks (TypeScript gets heuristic edges only from unbuilt workspace packages), so the report's
  "heuristic: no data" row gets data.
- Python eval tasks (a runnable Python repo, `python3 -m unittest`).
- **v1 eval suite.** Three of four v0 edit tasks pass every time without Catenet. v1 needs:
  - harder or realistic changes, a larger real repository, and ideally tasks written by someone other than Catenet's
    authors;
  - edit-task tokens as a pre-registered hypothesis (added as descriptive during the v0 run);
  - a third condition, "baseline + a run-the-type-checker nudge" (every v0 baseline failure was one `tsc` would flag);
  - dependents that are wrong only at runtime driving the edit metric;
  - the `q-dependents` answer without the debatable `export.ts`;
  - a rename acceptance test that accepts a deprecated alias kept in `store.ts`;
  - the cost cap in the lock;
  - committing (or tagging) the code, lock and pre-registration before the run.
- **Hook latency outliers.** In the v0 run, 11 of 138 Catenet sessions had a per-session hook p95 above 100 ms (worst
  1,154 ms; median 59 ms). Find the cause, which may be load from grading or other processes, and report a pooled p95
  next to the per-session one.
- **Shorter or conditional edit notes.** The note fires on every edit to a shared file; injecting it only when exports
  or behaviour change could cut the ~11% edit-token overhead (M5 policy).
- A Codex driver (M8) and gate false-positive labelling (M5).

## Visualization
- Run comparison UI (Claude Code vs Codex), session timeline / replay, memory view, hotspot treemap.

## CI
- CI integrations beyond `catenet guidance --check` and `catenet spec check`.
