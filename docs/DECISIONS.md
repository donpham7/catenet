# Decisions

Short ADR entries. One per non-obvious decision. Newest last. Status: proposed | accepted | superseded (by ADR-NNNN).

## ADR-0001: ADR nodes use kind `adr`, not `decision`
- **Date:** 2026-10-03 · **Status:** accepted
- **Context:** "decision" already names gate verdict records (`events.db` `decisions` table, `catenet why <decision-id>`). Using it as a graph node kind for architecture decision records made docs and queries ambiguous.
- **Decision:** the spec-layer node kind is `adr`. The edge kind `decided_by` (rule/component/requirement → adr) keeps its name. "Decision" means a gate decision everywhere else.
- **Consequences:** ARCHITECTURE, SPEC_LAYER, ROADMAP and the graph-model / storage diagrams updated.

## ADR-0002: Tests are `file`/`symbol` nodes with a test subkind; coverage is static
- **Date:** 2026-10-03 · **Status:** accepted
- **Context:** docs had a `test` node kind next to `file`, leaving it unclear whether a test file is one node or two. Blast-radius counts (covered vs uncovered dependents) depend on the answer.
- **Decision:**
  - No `test` node kind. A test file is a `file` node with `subkind: test`; an individual test case (only when needed, e.g. for requirement links) is a `symbol` node with `subkind: test_case`.
  - `tests` edges run from test files/cases to the files/symbols they import or reference; `verifies` edges (M6B) run from test files/cases to requirements.
  - Test files are never counted as dependents in blast radius.
  - A dependent is *covered* when it has an incoming `tests` edge. This is **static** coverage, and every surface (evidence, `catenet why`, docs) labels it so.
- **Consequences:** parsing, import resolution, hashing and incremental reindex treat test and source files identically. If M4 shows static coverage is too coarse, revisit (e.g. transitive reachability from tests, or importing runtime coverage reports).

## ADR-0003: One per-rule `on_match`; no global mode
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** the policy had a global `mode` (`observe | warn | enforce`) and a per-rule `action` (`allow | ask | deny`), plus a task-drift rule using `action: warn`, which mixed the two. Two interacting settings were hard to explain, and `warn`/`ask` did not say who is warned or asked.
- **Decision:**
  - No global mode. Each rule is a `match` (when it fires) and an `on_match` (what happens): `record_only | tell_agent | ask_human | block`.
  - `record_only` = edit goes ahead, only the decision log sees it; `tell_agent` = goes ahead, agent gets the explanation; `ask_human` = paused for human approval; `block` = refused with reason and alternative.
  - Several matches: strongest wins; all are recorded with their `on_match`.
  - `catenet init` ships every rule at `record_only`, so a fresh install never changes agent behavior. Trust is built by raising rules one at a time.
  - Engine caps in code, not config: `inferred` edges never `block` (max `ask_human`); task-drift max `tell_agent` in v1.
  - Internal verdicts stay `allow | ask | deny` (they mirror Claude Code's hook vocabulary). `decisions.mode` is removed; `decisions.evidence` lists matched rules, their `on_match` and caps.
  - Spec-layer rules use the same `on_match`, plus `ci: fail | report` for CI; their `severity` and `enforce` fields are removed.
  - Self-protection is a built-in rule, shipped at `record_only`; `catenet doctor` warns while any rule is stricter than it.
- **Consequences:** no single switch for "dry-run everything"; if needed later, it becomes a CLI flag, not a policy concept. ARCHITECTURE §2.5, ROADMAP M3/M5/M6A/M6B, SPEC_LAYER, VISION, CLAUDE.md principle 2, and diagrams 01, 02, 04, 05, 08 updated.

## ADR-0004: Terminology: policy vs. architecture rules, subsystems, off-task
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** three words each meant two or three different things in the docs.
- **Decision:**
  - **Rule:** "rule" alone means a *policy rule* (`match` + `on_match`). An *architecture rule* is a policy rule declared in a spec file; its graph node kind is `arch_rule`, the spec-file key is `arch_rules:`, and the policy match condition is `violates_arch_rule`.
  - **Component:** only the spec-layer unit of the user's architecture. Catenet's own parts (indexer, daemon, policy engine, ...) are *subsystems*; `errors.component` is renamed `errors.subsystem`.
  - **Drift:** only docs drifting from code (guidance drift, spec drift). Task drift is renamed *off-task detection*, rule id `off-task`. ADR-0003's mention of "task-drift" refers to this rule.
- **Consequences:** CLAUDE.md, ARCHITECTURE, SPEC_LAYER, ROADMAP, VISION, RESEARCH and diagrams 01, 03, 04, 05, 06 updated. Undefined counting terms (package, external, dependents, public API) are deliberately not settled here; see the M0 blast-radius counting ADR task in ROADMAP.

## ADR-0005: Runtime is Node 24 LTS or newer
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** CLAUDE.md said Node 20+. Node 20 reached end-of-life in April 2026. Current corepack (0.36) needs Node ≥ 22.22 and pnpm 11 needs Node ≥ 22.13, so Node 20 can only run pnpm 10 through an outdated corepack (verified on the owner's machine: corepack 0.24.1 cannot launch pnpm 12).
- **Decision:** develop and support Node 24 LTS and newer (`engines.node: ">=24"`). pnpm is pinned in the root `package.json` `packageManager` field and installed with corepack.
- **Consequences:** users on Node 22 are not supported; revisit if that blocks adoption (Node 22 is supported upstream until April 2027). Native dependencies (better-sqlite3, tree-sitter bindings) must ship prebuilds for Node 24; check this in the M0 spikes.

## ADR-0006: License is MIT
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** the choice was MIT vs. Apache-2.0 (adoption vs. explicit patent grant).
- **Decision:** MIT, chosen by the owner.
- **Consequences:** add `LICENSE` and `"license": "MIT"` in every package during the M0 skeleton.

## ADR-0007: Project name is Catenet
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** "Catenet" (from "concatenated network") was chosen in the brief. As of 2026-10-03 the bare name was free on npm and PyPI; GitHub handle, domains and trademarks were not checked.
- **Decision:** the project, CLI (`catenet`) and package scope use the name Catenet.
- **Consequences:** verify the GitHub handle, domain and trademark before any public release.

## ADR-0008: Blast-radius counting definitions
- **Date:** 2026-10-04 · **Status:** accepted (definitions confirmed by the owner)
- **Context:** fixture answer keys (M0) and the blast-radius score (M1/M5) need exact meanings for package, external, dependent and public API.
- **Decision:**
  - **Package:** a build unit: a directory with `package.json`, or a Python project with `pyproject.toml`/`setup.py`. Python import packages (`__init__.py` directories) are not package nodes. "Cross-package dependents" counts these units.
  - **External:** `external` nodes have `subkind: third_party` (resolves to an installed/declared dependency), `subkind: builtin` (language standard library or runtime built-in, e.g. Python `importlib`, `node:fs`; added while writing the fixtures) or `subkind: unresolved` (looks local or is dynamic, e.g. `import(\`./plugins/${name}\`)`, and could not be resolved). Evidence reports unresolved imports ("N unresolved imports may hide dependents").
  - **Dependent:** a file that reaches the target by reverse traversal over `imports | calls | references | inherits` edges. Test files are never dependents (they count toward coverage, ADR-0002). Direct = 1 hop; transitive = all hops, with cycle detection. Counts are in **files**; evidence lists the symbols involved. A symbol target's dependents are the files containing references to it (directly or through re-exports).
  - **Published API (replaces "public API"):** `published_api: true` only for files/symbols exported from the entry points of a *published* package: `package.json` `exports`/`main`/`types` of a package without `"private": true`; for Python, the top-level `__init__.py` (and `__all__` if present) of a project with a `[project] name`. Purpose: flag dependents that may exist outside the repo, which the graph cannot count. Rule `public-api-change` becomes `published-api-change`; weight `public_api` becomes `published_api`.
- **Consequences:** answer keys in `fixtures/*/answer-key.json` follow these definitions. Private apps get no published-API signal; in-repo risk is covered by cross-package dependents. To avoid reusing the retired term, the architecture rule kind `public_api_only` (a component may only be imported through its entry points) is renamed `entrypoint_only`.

## ADR-0009: Toolchain and MCP SDK
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** M0 needed a build, lint and test setup that works on Node 24, plus a verified MCP SDK. Research (2026-10-04): TypeScript 7 (native compiler) ships no programmatic API, so typescript-eslint cannot run on it; pnpm 12 fails installs on unreviewed dependency build scripts; MCP SDK v2 is the stable line.
- **Decision:**
  - **pnpm 12.9.1**, pinned via `packageManager`, installed with corepack. Settings live in `pnpm-workspace.yaml`. Every dependency install script is listed in `allowBuilds` with a reason.
  - **TypeScript 7** (`tsc`) for typechecking and emit. No bundler until distribution needs one (M3 plugin packaging).
  - **Biome 2** (`preset: recommended`) for lint and format. ESLint + typescript-eslint was rejected because it would need TypeScript 6 installed alongside 7; revisit when TypeScript 7.1 ships an API, if type-aware lint rules are wanted.
  - **Vitest 5** for tests.
  - **MCP: `@modelcontextprotocol/server` 2.x** with **zod 4** (`registerTool`, `inputSchema` as a zod object, `StdioServerTransport`; logs to stderr only). Verified by spike S3: tool round trip 0.18 ms p50, invalid input returns `isError` without crashing.
- **Dependencies added, and why:** `typescript`, `@biomejs/biome`, `vitest`, `@types/node` (root dev tooling); in `spikes/` only: `better-sqlite3` + `@types/better-sqlite3` (S1 comparison), `web-tree-sitter` + grammar packages (S2), `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `zod` (S3).
- **Consequences:** the tooling is very new (pnpm 12 Rust rewrite ~6 weeks old, Vitest 5 ~1 month, MCP v2 ~2 months), so expect minor churn; versions are pinned exactly.

## ADR-0010: SQLite binding is `node:sqlite`
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** spike S1 compared `better-sqlite3` 13.0.3 with Node 24's built-in `node:sqlite` (stability 1.2, release candidate) on the ARCHITECTURE 2.2 schema, 20k nodes / 64k edges, WAL. Results in `spikes/README.md`.
- **Decision:** use `node:sqlite` (`DatabaseSync`). Inserts and point lookups match `better-sqlite3`; full recursive-CTE traversals are ~1.2x slower (9.3 vs 7.7 ms p50, worst case), inside the 1.5x bar set before the spike. WAL, recursive CTEs, prepared statements and user-defined functions all work. It removes Catenet's only native dependency.
- **Consequences:** keep all SQL behind the `GraphStore` interface so `better-sqlite3` can be swapped in if `node:sqlite` changes API before it is marked stable, or if M1's real-repo numbers show traversal is the bottleneck. Both are synchronous: long queries block the daemon's event loop, so keep hook-path queries bounded.

## ADR-0011: Parser binding is `web-tree-sitter` (WASM)
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** spike S2 compared native `tree-sitter` 0.25.1 with `web-tree-sitter` 0.27.0 using the grammar packages' bundled `.wasm` files (TS/TSX ABI 14, JS/Python ABI 15). Results in `spikes/README.md`.
- **Decision:** use `web-tree-sitter` with the grammars' `.wasm` files. It is 1.3-1.8x slower at p50 (about 19 ms vs 13 ms for a 2,000-line TS file, both warm) but needs no native build, no pnpm build approvals and behaves identically on every platform; both found identical imports. Grammar packages stay in `allowBuilds` as `false`: their native build never runs.
- **Consequences:** WASM trees must be freed explicitly (`tree.delete()`, `query.delete()`). The TypeScript grammar is ~2 years old (0.23.2); new TS syntax may parse with error nodes, which the indexer must tolerate and report. If M6A's pre-edit analysis of proposed content (on the hook path) needs more speed, native is a drop-in swap behind the parser interface.

## ADR-0012: Hook transport per agent
- **Date:** 2026-10-04 · **Status:** accepted
- **Context:** spike S4 measured transport cost against the warm-path budget (p95 < 100 ms). Claude Code supports `http` hooks (except `SessionStart`); Codex supports only `command` (and `mcp_tool`) hooks. Results in `spikes/README.md`.
- **Decision:**
  - **Claude Code tool events** (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, ...) use **`http` hooks** to the daemon on loopback: 0.6 ms p95 transport, no process spawn, and a refused connection is already non-blocking in Claude Code (fail-open).
  - **Claude Code `SessionStart` and all Codex hooks** use a **plain-JS Node command client** (`node:net` only, no dependencies) talking to the daemon's unix socket: 47 ms p95 including Node startup, with a 250 ms hard timeout that exits 0 with no output (fail-open).
  - No compiled (Go/Rust) client and no `curl` dependency.
- **Consequences:** the daemon listens on both a unix socket and `127.0.0.1` with a random port; the loopback listener requires a per-daemon random token (sent as a header the hook config reads from an env var), per ARCHITECTURE 5. M3 must measure real end-to-end latency inside Claude Code, since S4 excludes Claude Code's own HTTP overhead.

## ADR-0013: Indexer design
- **Date:** 2026-10-07 · **Status:** accepted
- **Context:** M1 needs exact answer-key results on the fixtures and single-file reindex < 1 s on a 2k-file repo, with the graph always rebuildable.
- **Decision:**
  - **Three packages:** `@catenet/parsers` (pure: source text to `FileFacts`, no filesystem or resolution), `@catenet/core` (discovery, resolution, store, queries), `@catenet/cli` (thin).
  - **Discovery:** `git ls-files --cached --others --exclude-standard` inside a work tree, so `.gitignore` is honoured exactly; a directory walker with built-in ignores otherwise (including when git lists nothing, e.g. a directory ignored by an enclosing repo).
  - **Stable node identity** (file = path; symbol = path + qualified name + subkind; external = subkind + name; package = path + name + manifest) with upserts, so a reindex keeps incoming edges from other files.
  - **Stored facts** (`file_facts`): extracted facts are kept so importers can be re-resolved without re-parsing. They are a cache: `--full` and any change of `EXTRACTOR_VERSION` (in `@catenet/parsers`, bumped whenever extraction output changes) re-parse every file, so an upgrade never keeps stale facts. Added after code review, 2026-10-07.
  - **Config:** manifests, `tsconfig*.json` and every file reachable through a tsconfig's relative `extends` (any name, string or array) are hashed together; a change rebuilds.
  - **Concurrency:** one writer at a time. The store sets a 5 s busy timeout and writes in `BEGIN IMMEDIATE` transactions, so a second index run (later the daemon) waits instead of failing.
  - **Materialised `file_deps`**: the file-level projection of dependency edges; dependents traversals run on it.
  - **Incremental updates:** re-resolve changed and added files; every file whose import resolution differs between the old and new file sets (computed in memory); the importers of any file whose export surface changed, following files that re-expose names; and, for Python, the importers of a package whose set of submodules changed. Rebuild from stored facts only for `--full`, the first run, or a manifest/tsconfig change. Equality with a full rebuild is enforced by `test/incremental.test.ts`, which is mutation-checked (disabling either propagation rule makes it fail).
  - **Build wiring:** each package's `exports` has a `"source"` condition pointing at `src/index.ts`; Vitest and `tsc` use it, so tests and typecheck need no build, while the built CLI uses `dist/`.
  - **Dependency added:** `smol-toml` 1.9.0 in `@catenet/core`, to read `pyproject.toml` correctly (zero dependencies). `web-tree-sitter` and the grammar packages are added to `@catenet/parsers` (`spikes/` keeps its own copy so S2 stays reproducible; native builds stay disallowed, ADR-0011).
- **Consequences:** single-file reindex is 230-426 ms p95 on the 2k-file synthetic repo; a no-change run costs ~85 ms (it returns before reading stored facts, but still hashes every file), which M2's file watcher removes. CommonJS exports (`module.exports = ...`, `exports.x = ...`, calling a required module as its default export) were added after review. Deliberately not modelled (owner-approved 2026-10-07): intra-file calls (deferred to M5, where symbol-level evidence needs them), method calls on class instances (needs type inference; BACKLOG), and implicit Python parent-package imports (would turn every `__init__.py` into a noisy hub; BACKLOG).
