# M0 spikes

Throwaway measurement code that settled the M0 runtime choices. Results below were recorded on **2026-10-04**,
Apple M1 Pro, macOS 26.5.1, Node v24.21.0 (bundled SQLite 3.53.4). Numbers are machine-specific; re-run before
comparing. Decisions are in `docs/DECISIONS.md` (ADR-0009 to ADR-0012).

Run any spike from this directory (Node 24 runs `.ts` directly):

```sh
node s1-sqlite.ts        # SQLite bindings
node s2-tree-sitter.ts   # tree-sitter WASM (native comparison: see S2 note)
node s3-mcp-client.ts    # MCP stdio server + client
node s4-bench.ts         # hook transport latency
```

## S1: SQLite binding (ADR-0010)
ARCHITECTURE 2.2 schema, WAL, file database, synthetic graph of 20,000 nodes (2,000 files + 18,000 symbols) and 63,959
edges. "Dependents" is the cycle-safe recursive CTE over `imports|calls|references|inherits`, excluding test files.

| case | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| better-sqlite3 13.0.3: point lookup by path | 2000 | 0.002 | 0.004 | 1.557 |
| better-sqlite3: dependents of hub file (all hops) | 300 | 7.674 | 8.608 | 9.876 |
| better-sqlite3: dependents of random file (all hops) | 300 | 7.695 | 8.622 | 9.741 |
| better-sqlite3: bulk insert, one transaction | 1 | 202.1 | | |
| node:sqlite: point lookup by path | 2000 | 0.003 | 0.005 | 0.097 |
| node:sqlite: dependents of hub file (all hops) | 300 | 9.315 | 10.508 | 19.880 |
| node:sqlite: dependents of random file (all hops) | 300 | 9.281 | 10.370 | 15.380 |
| node:sqlite: bulk insert, one transaction | 1 | 208.0 | | |

- `PRAGMA journal_mode` reads back `wal` for node:sqlite; it loads with no experimental warning on 24.21.
- Caveat: the synthetic call graph is densely connected, so even a random file reaches ~1,800 dependent files. These
  are worst-case traversals; real repos will mostly be cheaper. M1's 2k-file synthetic repo re-measures this.

## S2: tree-sitter binding (ADR-0011)
Parse + import query, 40 timed runs after 5 untimed warmup runs. Inputs: synthetic 2k-line TS/TSX/Python files,
`@types/node/fs.d.ts` (4,778 lines), CPython `argparse.py` (2,672 lines). Both bindings found identical import counts.
Grammar ABI versions: typescript 14, tsx 14, javascript 15, python 15 (all load in web-tree-sitter 0.27.0).

| case | p50 ms | p95 ms | max ms |
|---|---|---|---|
| wasm: init + load 4 grammars | 22.9 | | |
| wasm: synthetic.ts (2k lines) | 18.889 | 19.880 | 19.972 |
| wasm: synthetic.tsx (2k lines) | 19.082 | 19.924 | 20.229 |
| wasm: synthetic.py (2k lines) | 12.780 | 13.547 | 13.877 |
| wasm: @types/node fs.d.ts | 15.348 | 16.000 | 16.151 |
| wasm: cpython argparse.py | 16.664 | 33.933 | 70.882 |
| native 0.25.1: require + load 4 grammars | 32.7 | | |
| native: synthetic.ts (2k lines) | 14.988 | 45.757 | 77.123 |
| native: synthetic.tsx (2k lines) | 13.410 | 16.008 | 18.669 |
| native: synthetic.py (2k lines) | 8.925 | 9.680 | 10.866 |
| native: @types/node fs.d.ts | 8.424 | 10.542 | 11.163 |
| native: cpython argparse.py | 9.597 | 10.567 | 11.523 |

- WASM is 1.3-1.8x slower at p50. Occasional tail spikes appeared on both sides (machine noise, not binding-specific).
- Native comparison note: the native `tree-sitter` package was removed after the decision. To reproduce, run
  `pnpm --filter spikes add tree-sitter@0.25.1` and set the grammar packages to `true` in `pnpm-workspace.yaml`
  `allowBuilds`; the script skips native when the package is absent.

## S3: MCP SDK v2 (ADR-0009)
`@modelcontextprotocol/server` 2.3.0 stdio server with one bounded tool (`find_symbol`, `inputSchema` as a zod 4
object), driven by `@modelcontextprotocol/client` 2.3.0 over `StdioClientTransport`.

| case | n | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| spawn server + initialize | 1 | 148.1 | | |
| tools/call find_symbol round trip | 200 | 0.178 | 0.586 | 1.384 |

- `listTools` and `callTool` behave as documented. Invalid input (empty query) returns `isError: true` rather than
  throwing or crashing the server. All server logging goes to stderr (stdout is JSON-RPC).

## S4: hook transport latency (ADR-0012)
Daemon stub (one HTTP handler on a unix socket and loopback TCP, canned decision). Each case is timed end to end,
including process spawn; N=300 after 5 discarded warmups. Payload: a realistic ~600-byte `PreToolUse` Edit event.

| case | p50 ms | p95 ms | max ms |
|---|---|---|---|
| baseline: spawn `true` (process spawn only) | 2.107 | 2.554 | 5.112 |
| baseline: `node -e 0` (Node startup only) | 37.239 | 46.132 | 126.460 |
| (a) command: `node s4-client.mjs` -> unix socket | 41.306 | 47.387 | 68.492 |
| (b) same + `NODE_COMPILE_CACHE` | 42.418 | 48.397 | 62.725 |
| (c) command: `curl --unix-socket` | 14.860 | 20.384 | 37.503 |
| (d) loopback HTTP POST, no spawn (≈ Claude Code `http` hook) | 0.301 | 0.636 | 1.407 |

- The Node client's cost is almost entirely Node startup; the socket round trip adds ~4 ms. The compile cache does
  not help a script this small.
- (d) excludes Claude Code's own overhead for issuing the HTTP hook; M3 measures real end-to-end latency.
- Not measured: a compiled (Go/Rust) client. Unnecessary, since (a) is inside the 100 ms budget.
