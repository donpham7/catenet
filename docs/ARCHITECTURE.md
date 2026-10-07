# Architecture

> Status: design proposal. Hook and MCP interface details MUST be verified against current official
> docs in M0 and recorded in `docs/HOOK_SCHEMAS.md`. Where this doc and the official docs disagree, the official docs win.

## 1. System overview

```
                 ┌────────────────────── Coding agent ──────────────────────┐
                 │  Claude Code  /  Codex CLI                               │
                 └───────┬───────────────────────────────┬──────────────────┘
          hooks (thin clients)                      MCP (read-only tools)
   SessionStart · UserPromptSubmit              find_symbol · get_dependents
   PreToolUse · PostToolUse                     impact_of · why · hotspots ...
   PreCompact/PostCompact · Stop                          │
                 │                                        │
                 ▼                                        ▼
        ┌──────────────────┐   neutral events   ┌──────────────────┐
        │ Adapters         │ ─────────────────▶ │  Catenet daemon  │
        │ claude-code,codex│ ◀───── decisions ─ │  (local, warm)   │
        └──────────────────┘                    └───────┬──────────┘
                                                        │
      ┌──────────────┬──────────────┬───────────────────┼───────────────┬─────────────┐
      ▼              ▼              ▼                   ▼               ▼             ▼
  Indexer       Query engine   Policy engine      Event recorder   Guidance gen   Web UI (read-only)
 (tree-sitter,  (deps, blast   (rules,           (sessions, tool  + drift check  (Sigma.js, SSE)
  watcher)       radius, roles) explanations)      calls, decisions)
      └──────────────┴──────────────┴───────────────────┴───────────────┘
                                   SQLite (WAL)
                       .catenet/graph.db   .catenet/events.db
```

**Key idea:** hooks are *thin clients*. They forward a payload to the long-lived daemon over a local
socket and return its decision. This keeps hook latency low (no per-call parse/startup cost) and lets
all agents share one graph.

## 2. Subsystems

### 2.1 Indexer (`packages/parsers`, `packages/core`)
- Parses source with tree-sitter via `web-tree-sitter` (WASM, ADR-0011). v1: TypeScript/JavaScript, Python.
- Emits nodes and edges (section 2.2) with a `confidence` (`exact` | `heuristic`) and `provenance` (`parser`).
- **Incremental:** content-hash per file; on change, re-parse that file and re-resolve its edges.
  Use a file watcher in the daemon plus `git diff` reconciliation on startup.
- Import resolution per language (tsconfig paths, package.json workspaces, Python packages/relative imports).
  Anything that does not resolve to a repo file becomes an `external` node with `subkind` `third_party`, `builtin` or
  `unresolved` (ADR-0008), never dropped silently.
- **Call edges are best-effort.** Mark dynamic dispatch / unresolved calls `heuristic`. Never present
  heuristic edges as certain in explanations.
- Test mapping (ADR-0002): detect test files by convention and config and store them as `file` nodes with
  `subkind: test` (individual test cases, when needed, are `symbol` nodes with `subkind: test_case`). Add `tests`
  edges from test files/cases to the symbols/files they import or reference. There is no separate `test` node kind.

### 2.2 Graph store
SQLite via Node's built-in `node:sqlite` (ADR-0010), WAL mode, one DB per repo under `.catenet/` (git-ignored by default).

```sql
CREATE TABLE nodes (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,   -- repo|package|file|symbol|external (M6A/M6B add component|requirement|arch_rule|adr)
  subkind     TEXT,            -- file: source|test; symbol: function|class|method|type|variable|test_case|...
  name        TEXT NOT NULL,
  path        TEXT,            -- repo-relative, for file/symbol
  start_line  INTEGER, end_line INTEGER,
  lang        TEXT,
  content_hash TEXT,           -- file hash, or symbol-region hash
  attrs       TEXT,            -- JSON (exported?, visibility, signature...)
  updated_at  INTEGER NOT NULL
);
CREATE TABLE edges (
  src         INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  dst         INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,   -- contains|imports|calls|references|inherits|tests|depends_on (M6A/M6B add spec kinds)
  confidence  TEXT NOT NULL,   -- exact|heuristic
  provenance  TEXT NOT NULL,   -- parser (M1); declared|tagged|inferred (spec layer)
  attrs       TEXT,
  PRIMARY KEY (src, dst, kind)
);
CREATE INDEX edges_dst ON edges(dst, kind);   -- reverse traversal is the hot path
CREATE INDEX nodes_path ON nodes(path);
CREATE INDEX nodes_name ON nodes(name);
CREATE TABLE meta (schema_version INTEGER NOT NULL);  -- reported by `catenet doctor`
```
`kind` columns are free text validated in code (no CHECK constraint), so the spec layer adds kinds without a schema rewrite.

Derived data (roles, fan-in, hotspot scores) is computed and cached in a `metrics` table; it is
always rebuildable. **Nobody edits the graph.** A rescan can drop and rebuild everything.

Kuzu or another graph DB is a possible later swap; keep the store behind an interface
(`GraphStore`) so queries don't leak SQL.

### 2.3 Query engine
Core read-only queries (all return structured results plus the paths/edges that justify them):
- `findSymbol(name|pattern)`, `getFile(path)`
- `dependencies(node, depth)`, `dependents(node, depth, kinds)` via recursive CTE
- `impact(nodeOrFileSet)` → `{direct, transitive, packages, tests{covered, uncovered}, publishedApi, unresolvedImports, score, evidence[]}`
- `roles()` → hub/core/leaf, from fan-in/out and centrality
- `hotspots()` → ranked by fan-in x churn (git log) x uncovered-ness
- `testsFor(node)`

**Blast radius score (initial, tunable, documented in code):**
```
score = w1*direct_dependents + w2*transitive_dependents + w3*cross_package_dependents
      + w4*published_api_flag + w5*(uncovered_dependents/total) + w6*churn_percentile
capped to 0..100; weights live in policy config; heuristic edges count at 0.5 weight.
```
Always return the raw counts alongside the score; the score alone is not an explanation. What counts as a dependent,
a package and published API is defined in ADR-0008; `fixtures/README.md` shows worked examples.

**Test coverage semantics (ADR-0002):** test files are never counted as dependents. A dependent is *covered* when it has
an incoming `tests` edge. This is **static** coverage ("some test imports or references it"), not runtime coverage;
evidence, `catenet why` and docs must label it that way.

### 2.4 Event recorder (`events.db`)
Neutral schema, agent-independent:
```
sessions(id, agent, agent_version, started_at, ended_at, cwd, git_head)
prompts(id, session_id, ts, text_hash, text_preview_redacted)     -- full text NOT stored by default
tool_calls(id, session_id, ts, tool, target_paths JSON, args_summary, outcome, duration_ms)
decisions(id, session_id, tool_call_id NULL, ts, verdict, rule_ids JSON, evidence JSON, latency_ms)
                                                                   -- tool_call_id NULL for post-edit violation decisions
diffs(id, session_id, ts, path, added, removed, content_hash_before, content_hash_after)
errors(id, ts, subsystem, message)                                 -- hook/daemon failures (fail-open log)
meta(schema_version)                                               -- reported by `catenet doctor`
```
`tool_calls.args_summary` is redacted like any other stored text. `decisions.evidence` lists every matched rule with its `on_match` and any engine cap applied. This section is the source of truth for the event schema; `docs/diagrams/04-storage-er.mermaid` mirrors it.
Privacy defaults: store paths, hashes, counts, and short redacted previews; store file contents or full
prompts only with an explicit opt-in setting. Run a secrets-redaction pass on any stored text.

### 2.5 Policy engine (`packages/core/policy`)
Config: `.catenet/policy.yaml` (committed by default so teams share rules; local override in
`.catenet/policy.local.yaml`).

```yaml
# Default policy written by `catenet init`: every rule starts at record_only (ADR-0003).
rules:
  - id: self-protection          # built in: .catenet/policy*.yaml, spec files, hook configs
    on_match: record_only        # raise to ask_human together with your first stricter rule
  - id: protected-paths
    match: { paths: ["migrations/**", ".env*", "**/secrets/**", "**/generated/**"] }
    on_match: record_only        # typical target: block
    message: "Protected path. Create a new migration / edit the source of generated code instead."
  - id: high-blast-radius
    match: { tools: [Edit, Write], impact: { score_gte: 60 } }
    on_match: record_only        # typical target: ask_human
  - id: published-api-change
    match: { tools: [Edit, Write], attrs: { published_api: true }, impact: { uncovered_dependents_gte: 1 } }
    on_match: record_only        # typical target: tell_agent, later ask_human
  - id: off-task
    experimental: true           # label only: shown in reports and evidence, no effect on behavior
    on_match: record_only        # engine caps this at tell_agent in v1
weights: { direct: 1.0, transitive: 0.3, cross_package: 2.0, published_api: 15, uncovered: 20, churn: 10 }
```
A rule is a `match` (when it fires) and an `on_match` (what happens). There is no global mode. In these docs "rule" alone means a
**policy rule**; an **architecture rule** (spec layer, ADR-0004) is a policy rule declared in a spec file.

| `on_match` | What happens | Verdict sent to the adapter | Example |
|---|---|---|---|
| `record_only` | The tool call goes ahead; only the decision log sees it | `allow` | A new rule you are trialing; see how often it fires in `catenet report` |
| `tell_agent` | The tool call goes ahead; the agent gets the explanation as feedback | `allow` + additional context | Off-task edits; an edit adding a forbidden import, so the agent fixes it in the same turn |
| `ask_human` | The tool call pauses until the person running the session approves or rejects it (via the agent's own permission prompt) | `ask` | Editing a helper with 38 dependents; code satisfying a high-risk requirement |
| `block` | The tool call is refused, with the reason and the alternative | `deny` | Applied migrations, `.env.production`, generated code |

Semantics:
- **Several matches:** the strongest `on_match` wins (`block` > `ask_human` > `tell_agent` > `record_only`); every matched rule is
  recorded with its `on_match`.
- **Verdicts** (`allow | ask | deny`) are internal: they are what the adapter translates into the agent's hook response, and they
  mirror Claude Code's hook vocabulary. Users only write `on_match` values.
- **Engine caps** (code, not config): edges with `inferred` provenance never cause `block` (capped at `ask_human`); `off-task` is
  capped at `tell_agent` in v1. Every cap is recorded in the evidence.
- **Building trust:** rules ship at `record_only`, so a fresh install never changes agent behavior. Raise one rule at a time once
  `catenet report` shows it fires usefully.
- **Fail-open:** daemon unreachable, timeout (hard cap, e.g. 250 ms), or internal error → allow + write to `errors`.
- **Explainability:** every decision stores evidence; `catenet why <id>` renders it.
- **Bash tool:** parse obvious file-mutating commands conservatively (`rm`, `mv`, `sed -i`, redirects, `git checkout/reset`);
  unparseable commands are allowed and recorded. A Bash command that appears to touch a matched path gets at most `ask_human`
  (never `block` on a guess). Never claim Bash coverage is complete.
- **Policy self-protection:** a built-in rule matching agent edits to `.catenet/policy*.yaml`, spec files and hook configs. It ships
  at `record_only` like every rule; the threat it covers is an agent loosening a policy that has stricter rules, so raise it to
  `ask_human` with your first stricter rule. `catenet doctor` warns while any rule is stricter than `self-protection`.
- **`ask_human` limits (HOOK_SCHEMAS.md 7, 10):** in a headless Claude Code run (`claude -p` with no permission host) an `ask`
  is **denied**, so `ask_human` behaves like `block` there. Codex has no working `ask` at all; its mapping is an M8 decision.

### 2.5.1 Off-task detection (experimental, capped at `tell_agent`)
Capture the prompt at `UserPromptSubmit`; extract mentioned paths/symbols/terms; compare edits against
the neighborhood of files read/mentioned. Low precision is expected; at most tell the agent, with the evidence;
measure false-positive rate before ever promoting it.

### 2.6 Adapters (`packages/adapters/*`)
Translate agent-specific hook payloads to neutral events and neutral decisions back to the agent's response format.

Exact payloads, responses and caveats are in `docs/HOOK_SCHEMAS.md` (verified 2026-10-04). Transport per ADR-0012.

**Claude Code**: hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
`PreCompact`/`PostCompact`, `Stop`, `SessionEnd`. Tool events use **`http` hooks** to the daemon's loopback listener (no
process spawn; a refused connection is non-blocking, so fail-open is built in). `SessionStart` supports only command
hooks, so it uses the Node command client. Decisions go in `hookSpecificOutput.permissionDecision` (`ask` / `deny`);
`tell_agent` context goes in `additionalContext`. Package as a Claude Code **plugin** (`hooks/hooks.json`, `.mcp.json`,
`skills/`) so install is one step.

**Codex CLI**: command hooks only (`hooks.json` or `[hooks]` in `config.toml`), all through the Node command client.
Edits arrive as `tool_name: "apply_patch"` with the patch text in `tool_input.command`, so the adapter must parse the patch
to find target paths (grammar to be confirmed in M8). There is no working `ask`. Project hooks require hash-based trust
review (`/hooks`), so install docs must cover it. Unsupported output fields fail the hook run (the tool proceeds); lock the
contract down with schema tests against recorded payloads.

Adapter constraints: tiny, no business logic, never throw to the agent, honor fail-open, never emit an explicit `allow`
(that would skip the user's own permission prompts), and keep injected context to **at most ~2,000 tokens** so it fits
both agents' caps. The command client is plain JS on `node:net` with a 250 ms hard timeout (S4: 47 ms p95).

### 2.7 MCP server (`packages/mcp`)
Read-only tools, built on `@modelcontextprotocol/server` v2 (ADR-0009). Stdio transport first; stdout is reserved
for JSON-RPC, so all logging goes to stderr. Keep tool descriptions precise (models choose tools from them) and responses compact
(bounded size, with `truncated: true` plus a hint to narrow the query).

| Tool | Purpose |
|---|---|
| `find_symbol` | Locate definitions by name/pattern |
| `get_dependents` | Who depends on this file/symbol (depth, kinds) |
| `get_dependencies` | What this file/symbol depends on |
| `impact_of` | Blast radius summary with evidence |
| `get_hotspots` | Risky areas of the repo |
| `tests_for` | Tests covering a file/symbol |
| `repo_map` | Compact map of packages, top-level directories and entry points |
| `why` | Explain a past gate decision by id |
| `session_summary` | What happened in the current/last session |
| `rescan` | Trigger incremental/full reindex (the only side-effecting tool; affects only derived data) |

Later (M9): `remember`, `recall`, `stale_report`.

Because agents under-use MCP tools, the adapters also **inject context proactively** (e.g., at `PreToolUse` for an edit, attach
the dependents and tests in the hook's additional context; at `SessionStart`, attach a compact repo map and active policy summary).

### 2.8 Guidance generator and drift checker (`packages/guidance`)
- `catenet guidance --write` generates `AGENTS.md` (root, plus optional per-directory files in monorepos).
- Generated sections live between markers; humans write anywhere else; regeneration touches **only** marked blocks:
  ```
  <!-- catenet:begin section=hotspots hash=ab12cd -->
  ...generated content...
  <!-- catenet:end section=hotspots -->
  ```
- Sections: `map`, `commands` (detected from package.json/Makefile/pyproject etc.), `hotspots`, `protected-zones`
  (mirrors the policy file), `conventions` (clearly labeled *observed*, not *required*), later `verified-notes` from memory.
- **Budget:** enforce a token budget (default ~1.5k tokens for root file); link to deeper docs rather than inlining.
- **Drift check** (`catenet guidance --check`, exit non-zero): every generated claim is re-validated against the graph
  (paths exist, symbols exist, counts within tolerance). Output lists stale sections with reasons. Usable as pre-commit/CI.
- `CLAUDE.md` imports the generated file with `@AGENTS.md` (verified syntax; never read twice). Claude Code also reads
  `AGENTS.md` natively, but only when no `CLAUDE.md` exists, so the import is still needed. Codex reads `AGENTS.md` natively.
- Security: generated text is derived from untrusted repo content. Escape/quote derived strings, strip control characters,
  cap lengths, never include secrets or absolute local paths. Always show a diff and require a human to commit it.
- Optional: read human-authored constraints from `AGENTS.md` back into policy *only* via an explicit opt-in marker block.

### 2.9 Visualization (`packages/ui`)
Read-only local web app, served by the daemon on `127.0.0.1` (random port, token-protected), live updates over SSE.

**v1 view: Blast-radius map with live session overlay.**
- Search/select a file or symbol → focused neighborhood (default depth 2), expandable on demand.
- Node color = risk; size = fan-in; edge style = confidence (solid exact, dashed heuristic).
- Live overlay: nodes the agent read/edited glow; decision markers (allow/ask/deny) appear on nodes; click for evidence.
- "Why was this blocked?" side panel renders `decisions.evidence`.
- Scale limits: never render the whole repo by default; package-level aggregate overview; precomputed layout for big graphs;
  cap visible nodes with a clear "N more" affordance.
- Export: self-contained static HTML snapshot for PRs/incidents.

Later views: session timeline/replay, run comparison (Claude Code vs Codex), hotspot treemap, memory freshness (M9).

### 2.10 CLI (`packages/cli`)
```
catenet init                 # create .catenet/, default policy (all rules record_only), install adapters (asks first)
catenet index [--full]       # (re)build the graph
catenet impact <path|symbol> # blast radius with evidence
catenet deps|dependents <x>
catenet why <decision-id>
catenet report [--session last]
catenet guidance --write|--check
catenet ui                   # open the visualization
catenet doctor               # daemon health, hook install state, schema versions, latency probe
catenet eval ...             # run the benchmark harness
```

### 2.11 Spec layer (declared intent), M6A/M6B
Detailed in `docs/SPEC_LAYER.md`. Summary: the indexer also reads spec files (components, architecture rules, requirements, ADRs) and derives
`component`, `requirement`, `arch_rule`, `adr` nodes and `belongs_to`, `component_depends_on`, `satisfies`, `verifies`, `governs`, `decided_by`, `refines` edges, each with
`provenance` (`declared|tagged|inferred`). The graph remains read-only; intent is edited in git files. Policy gains match conditions (`component`, `requirement_priority`, `violates_arch_rule`)
and a requirement-risk weight. Design the `nodes.kind` / `edges.kind` columns and the policy matcher to be extensible from M1 so this requires no schema rewrite.

## 3. Data flow: a gated edit
1. Agent decides to call `Edit` on `lib/format.ts`.
2. Claude Code runs the `PreToolUse` hook → adapter forwards `{tool, paths, session}` to the daemon (socket).
3. Daemon resolves the file → node, computes `impact` (cached), evaluates matching policy rules.
4. Daemon records a `decision` (verdict, rules, evidence, latency) and returns it.
5. Adapter returns allow / ask / deny (+ optional additional context with dependents and tests) in the agent's response format.
6. After the edit, `PostToolUse` records the diff stats and triggers an incremental reindex of the file.
7. UI (if open) receives the events over SSE.

## 4. Testing strategy
- **Unit:** extractors (golden tests per language), import resolution, blast radius math, policy matching, marker regeneration.
- **Fixtures:** small repos with *seeded hidden dependencies* (re-exports, barrel files, dynamic import strings, DI), each with an
  answer key of true dependents. Used for both correctness tests and the benchmark.
- **Adapter contract tests:** feed recorded hook payloads (from `HOOK_SCHEMAS.md`) and assert exact response JSON; fuzz malformed input
  to prove fail-open behavior.
- **E2E:** scripted headless agent runs where possible; otherwise replay recorded sessions.
- **Performance:** latency benchmark on a synthetic 2k-file repo; assert the p95 budget in CI.

## 5. Security and privacy
- Daemon binds to a unix socket (preferred) or loopback with a random access token generated at daemon start; no remote access.
- No network egress. No telemetry.
- Event log redaction; opt-in for storing contents.
- Prompt-injection hygiene for anything written into agent-visible text (guidance, injected context, error messages).
- Policy, spec and hook files are covered by the built-in `self-protection` rule (see 2.5).
- `.catenet/` git-ignored except `policy.yaml` (and optionally generated guidance, which lives in `AGENTS.md`).

## 6. Later: anchored memory (M9)
Memories are nodes of kind `memory` with anchors: `{path, symbol, region_hash, commit}`. Recall re-resolves the symbol and re-hashes:
unchanged → `fresh`; changed → `stale` (still returned, clearly flagged); missing → `orphaned`. Whitespace-only changes don't invalidate;
moved symbols re-anchor by name. Contradictions between memories are detected and resolved by recency/confidence with the loser marked superseded.
Memories carry provenance (who/what recorded them) and are treated as untrusted data when injected. Writes come from the agent via a tool
and from humans via `AGENTS.md`; they are never edits to the derived graph.
