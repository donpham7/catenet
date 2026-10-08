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
- **Discovery:** `git ls-files --cached --others --exclude-standard` inside a work tree (honours `.gitignore`), else a
  walker with built-in ignores. Packages are found from `package.json` / `pyproject.toml` / `setup.py` (ADR-0008).
- **Extraction** (`@catenet/parsers`, pure): source text to `FileFacts` (symbols with export names, imports with
  bindings, uses of imported names, class heritage, `__all__`, parse-error count). CommonJS `module.exports` /
  `exports.x` are treated as exports; calling a `require`d module directly uses its default export.
- **Import resolution** per language: relative paths with TS extension probing, tsconfig `paths`/`baseUrl` (JSONC,
  relative `extends`; exact pattern first, then longest prefix, falling back to normal resolution when the alias
  target is missing; an undeclared fallback stays `unresolved`), workspace package names via `package.json` `exports`/`main` (with a heuristic `dist/` to `src/`
  mapping), Node built-ins; Python source roots, relative imports, `__init__.py`, the stdlib list and declared
  dependencies. Anything that does not resolve to a repo file becomes an `external` node with `subkind`
  `third_party`, `builtin` or `unresolved` (ADR-0008), never dropped silently.
- **Symbol resolution** follows import bindings through `export *`, `export { x } from`, Python package re-exports and
  `__all__` to the defining symbol, so a call through a barrel is a direct dependency on the defining file. Imported
  names become `references` edges (the name is imported, used or not); uses become `calls`/`references` from the
  enclosing symbol; `extends` becomes `inherits`; files that re-export a symbol get a `references` edge to it.
- **Incremental (ADR-0013):** content hash per file; extracted facts are stored, so only changed files are re-parsed.
  An update re-resolves changed and added files, every file whose import resolution differs between the old and new
  file sets, and the importers of any file whose export surface changed (following files that re-expose names). A
  manifest or tsconfig change, `--full`, or the first run rebuilds from stored facts. `test/incremental.test.ts`
  checks that every update equals a full rebuild. M2's daemon adds a file watcher and `git diff` reconciliation.
- **Call edges are best-effort.** Mark dynamic dispatch / unresolved calls `heuristic`. Never present
  heuristic edges as certain in explanations.
- Test mapping (ADR-0002): detect test files by convention (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`,
  `test_*.py`, `*_test.py`; config-based detection later) and store them as `file` nodes with `subkind: test`
  (individual test cases, when needed, are `symbol` nodes with `subkind: test_case`). Every dependency edge from a
  test file has kind `tests`, so tests are never dependents. There is no separate `test` node kind.

### 2.2 Graph store
SQLite via Node's built-in `node:sqlite` (ADR-0010), WAL mode, one DB per repo under `.catenet/` (git-ignored by default).
The authoritative schema and migrations are in `packages/core/src/store/schema.ts`; this is a summary.

```sql
CREATE TABLE nodes (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,   -- repo|package|file|symbol|external (M6A/M6B add component|requirement|arch_rule|adr)
  subkind     TEXT,            -- file: source|test; symbol: function|class|method|type|variable|test_case|...
  name        TEXT NOT NULL,   -- symbols: qualified name (Class.method); externals: package/module name or specifier
  path        TEXT,            -- repo-relative, for package/file/symbol
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
CREATE UNIQUE INDEX nodes_identity ON nodes(kind, coalesce(path,''), name, coalesce(subkind,''));  -- stable upserts
CREATE INDEX edges_dst ON edges(dst, kind);   -- reverse traversal is the hot path
CREATE INDEX nodes_path ON nodes(path);
CREATE INDEX nodes_name ON nodes(name);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- schema_version (reported by `catenet doctor`), config_hash
-- Derived, rebuildable (ADR-0013):
CREATE TABLE file_facts (file_id PRIMARY KEY -> nodes, content_hash, facts_json);   -- re-resolve without re-parsing
CREATE TABLE file_deps  (src_file -> nodes, dst_file -> nodes, confidence, PRIMARY KEY (src_file, dst_file));
```
Nodes keep a stable identity (file = path; symbol = path + qualified name + subkind; external = subkind + name), so a
reindex upserts rows and incoming edges from other files survive. `file_deps` is the file-level projection of
`imports|calls|references|inherits` edges (exact if any underlying edge is exact); traversals run on it.
`kind` columns are free text validated in code (no CHECK constraint), so the spec layer adds kinds without a schema rewrite.

Derived data (roles, fan-in, hotspot scores) will be computed and cached in a `metrics` table (not in M1); it is
always rebuildable. **Nobody edits the graph.** A rescan can drop and rebuild everything.

Kuzu or another graph DB is a possible later swap; all SQL lives in `SqliteGraphStore`
(`packages/core/src/store/sqlite-store.ts`), so queries and the indexer don't leak SQL.

### 2.3 Query engine
Core read-only queries (all return structured results plus the paths/edges that justify them):
Targets are `path`, `path#Symbol` or a bare symbol name (ambiguous names list candidates). Implemented in M1
(`packages/core/src/query/graph.ts`):
- `findSymbols(name)`
- `dependents(target, depth?)`: direct = files with a dependency edge into the target file or its symbols (or into
  the target symbol); transitive = breadth-first closure over `file_deps`, cycle-safe; confidence is `exact` only
  along an all-exact path. `dependencies(target, depth?)` is the forward equivalent.
- `impact(target)` → `{direct, transitive, packages, crossPackage, tests{kind: "static", covered, uncovered,
  targetCovered}, publishedApi, unresolvedImports, evidence[]}`. `unresolvedImports` lists unresolved import sites in
  the target's package (they may hide dependents). The score below arrives with policy weights in M5.

Later: `roles()`, `hotspots()`, `testsFor()`.
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

### 2.4 Event recorder (`events.db`), M3
`.catenet/events.db`, written by the daemon's `POST /hook` handler (ADR-0015). Neutral schema, agent-independent; every
table except `errors` and `meta` also has `agent`, and sessions are keyed by `(agent, session_id)`:
```
sessions(agent, id, model, source, cwd, git_head, started_at, last_event_at, ended_at, end_reason, turns)
                                                                   -- source: how it first started (resume/compact keep it)
prompts(id, session_id, ts, text_hash, text_preview_redacted)     -- full text NOT stored by default
tool_calls(id, session_id, tool_use_id, ts, tool, target_paths JSON, args_summary, outcome, duration_ms, ended_at)
                                                                   -- outcome: succeeded|failed|denied|unknown
diffs(id, session_id, tool_use_id, ts, path, added, removed, hash_before, hash_after, partial)
compactions(id, session_id, ts, phase, trigger)                    -- phase pre|post, trigger manual|auto
hook_calls(id, session_id, ts, event, sync, ms, context_chars)     -- ms: hook process start to daemon answer;
                                                                   -- sync: the agent waited for it; context_chars:
                                                                   -- length of context added (0 = none; schema v3)
decisions(id, session_id, tool_use_id NULL, ts, verdict, rule_ids JSON, evidence JSON, latency_ms)
                                                                   -- M5; tool_use_id NULL for post-edit violation decisions
errors(id, ts, component, message)                                 -- hook/daemon failures (fail-open log)
meta(key, value)                                                   -- schema_version, reported by `catenet doctor`
```
This section is the source of truth for the event schema; `docs/diagrams/04-storage-er.mermaid` mirrors it.
`decisions.evidence` lists every matched rule with its `on_match` and any engine cap applied.
- **Tool calls:** one row per `tool_use_id`, opened by `PreToolUse` (edit tools only) and closed by `PostToolUse`
  (`succeeded`), `PostToolUseFailure` (`failed`) or `PermissionDenied` (`denied`); `unknown` if no end event arrives.
- **Diffs** (Edit, Write, MultiEdit, NotebookEdit, successful calls only): the daemon reads the file at `PreToolUse`
  (held in memory only, 10-minute expiry) and again at `PostToolUse`, and stores multiset line counts plus content
  hashes. It reads only regular files inside the repository (after resolving symlinks) of at most 2 MB; pipes, devices
  and files outside the repository are never opened. A row has `partial = 1` and no line counts when the before-state
  is missing (daemon restarted, or the call took over 10 minutes) or a read was skipped. Bash-made changes get no diff.
- **Privacy defaults:** store paths, hashes, counts, and short redacted previews: prompts as a hash plus 120 characters,
  `args_summary` at most 200 characters (a Bash command's first line only, so heredoc and here-string bodies are
  dropped; a search pattern; a URL), never file contents, edit strings or tool output. Tool-call paths are relative to
  the repository root. All stored text goes through `redactSecrets`: private keys; AWS, GitHub, GitLab, Google,
  OpenAI/Anthropic `sk-`, Stripe, Slack and JWT tokens; `Bearer`/`Basic` credentials; passwords in URLs, `curl -u`,
  `mysql -p` and `docker login -p`; secret-named flags (`--password`, `--api-key`, ...); and `key = value`,
  `key: value` and JSON assignments whose key names a secret (password, passwd, pwd, pass, secret, token, api key,
  access key, private key, credential), quoted values included. Storing contents or full prompts would need an
  explicit opt-in setting (not built).
- **Schema version:** `meta.schema_version` is checked on open. The daemon, the only writer, renames a file from
  another version to `events.db.v<N>.bak` (never overwriting an earlier backup) and starts a fresh one; readers such
  as `catenet report` leave it alone and say so (the log is local and pre-release).
- **Paths through symlinks:** tool-call paths are made repository-relative after resolving symlinks in their
  directories (agents may report `/private/var/...` for a repo at `/var/...`), but not in the file name, so a symlinked
  file inside the repo keeps its own name, as the indexer does. Reading a file for diffs still checks its real path.
- **Retention:** 30 days (`retentionDays` in `.catenet/config.json`), pruned right after the daemon answers its first
  hook.
- **`catenet report [--session last|<id>] [--json]`** reads it: session facts (local times), prompts, tool calls by
  tool and outcome, edited files with diff stats and their current blast radius, compactions, and hooks: how many the
  daemon answered, p50/p95/max over the synchronous ones (from hook process start to the daemon's answer, which leaves
  out Claude Code's own spawn cost and Node's exit), and how many failed, counted from the hook client's
  `.catenet/hook-errors.log` (one tab-separated line per failure: time, event, session id, message).

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

Exact payloads, responses and caveats are in `docs/HOOK_SCHEMAS.md` (verified 2026-10-04, Claude Code payloads re-checked against real sessions in M3). Transport: ADR-0015 for Claude Code, ADR-0012 for Codex.

**Claude Code** (`packages/adapters/claude-code`, M3, ADR-0015): `translate(payload)` maps a hook payload to a neutral
event and `respond(event, context)` builds the response. Every hook is a **command hook** running the bundled client
(`hook.mjs`): `SessionStart`, `PreToolUse` (edit tools only), `Stop` and `SessionEnd` are synchronous;
`UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `PreCompact` and `PostCompact` are `async`
(Claude Code doesn't wait for them). M3 responds only with `additionalContext` (`SessionStart` repo map, `PreToolUse`
blast radius summary) and never with `permissionDecision`; M5 adds `ask` / `deny`. Packaged as a plugin (2.13).
Contract tests use the HOOK_SCHEMAS examples and payloads recorded from real sessions (`test/payloads/`).

**Codex CLI**: command hooks only (`hooks.json` or `[hooks]` in `config.toml`), all through the Node command client.
Edits arrive as `tool_name: "apply_patch"` with the patch text in `tool_input.command`, so the adapter must parse the patch
to find target paths (grammar to be confirmed in M8). There is no working `ask`. Project hooks require hash-based trust
review (`/hooks`), so install docs must cover it. Unsupported output fields fail the hook run (the tool proceeds); lock the
contract down with schema tests against recorded payloads.

Adapter constraints: tiny, no business logic, never throw to the agent, honor fail-open, never emit an explicit `allow`
(that would skip the user's own permission prompts), and keep injected context to **at most ~2,000 tokens** so it fits
both agents' caps. The command client uses Node built-ins only and has a 250 ms timeout on `PreToolUse` (2 s for other
events). It finds the repository by walking up from the session's directory to the nearest `.catenet/config.json`
(only `catenet init` writes it), never accepting the home directory or the filesystem root, and does nothing when there
is none. It drops `tool_response` and `last_assistant_message` before sending, logs any failure or non-200 answer to
`.catenet/hook-errors.log` (rotated at 512 KB), and starts a daemon only at `SessionStart` and only when none is
running (a slow daemon is left alone).

### 2.7 MCP server (`packages/mcp`)
Read-only tools, built on `@modelcontextprotocol/server` v2 (ADR-0009), run as `catenet mcp` (stdio; stdout is
reserved for JSON-RPC, so all logging goes to stderr). The server **reads `graph.db` directly** (WAL allows concurrent
readers) and starts the repo's daemon (2.12) so the graph stays current; if the daemon is down, tools still answer from
the last index (ADR-0014). Every response is JSON data, never prose: sanitised (`sanitizeText`), deterministic in order,
bounded (default limits, hard maximum 200, `truncated: true` plus a hint), and stamped with
`freshness: {indexedAt, daemon}`. Tool descriptions are precise because models choose tools from them.

| Tool | Purpose | Status |
|---|---|---|
| `find_symbol` | Locate definitions by exact name or `Class.method` | M2 |
| `get_dependents` | Who depends on this file/symbol: direct and indirect files (depth, limit) | M2 |
| `get_dependencies` | What this file/symbol depends on | M2 |
| `impact_of` | Blast radius with evidence, static tests, published API, unresolved imports | M2 |
| `tests_for` | Test files that statically reach a file/symbol | M2 |
| `repo_map` | Packages, top-level directories, published entry points, hub files, counts | M2 |
| `rescan` | Incremental or full reindex via the daemon (in-process fallback); changes only derived data | M2 |
| `get_hotspots` | Risky areas (fan-in x churn x untested) | M6 |
| `why` | Explain a past gate decision by id | M5 |
| `session_summary` | What happened in the current/last session | M3 |

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
catenet init                 # opt in: create .catenet/ (own .gitignore, config.json), index, start daemon, print plugin install steps (M3)
                             # refuses a missing directory, the home directory and /
                             # M5 adds the default policy (all rules record_only)
catenet index [--full]       # build or incrementally update the graph            (M1)
catenet impact <target>      # blast radius with evidence                          (M1)
catenet deps|dependents <target> [--depth N]                                       (M1)
                             # all M1 commands: --repo <dir> (default git root, else cwd), --json
catenet why <decision-id>
catenet report [--session last|<id>] [--json]                                       (M3)
catenet hook <agent> [--repo <dir>]  # the hook client, for manual settings.json setups (M3)
catenet guidance --write|--check
catenet daemon start|stop|status                                                    (M2)
catenet mcp [--no-daemon]    # MCP server over stdio; root: the opted-in repo containing $CLAUDE_PROJECT_DIR  (M2)
catenet doctor [--json]      # node (own and on PATH), graph versions, freshness, daemon, MCP handshake, recent hook
                             # failures; exit 1 if unhealthy  (M2, M3)
catenet ui                   # open the visualization
catenet eval run|report|lock # the benchmark harness (packages/eval, M4): pre-registered tasks with and without
                             # Catenet, paired effects with CIs; --driver patch is a free self-test, --plan prices a run
```

### 2.12 Daemon (`packages/daemon`), M2
One long-lived process per repository, and the graph's only long-lived writer (ADR-0014).
- **Location:** an HTTP server on a unix socket in `$XDG_RUNTIME_DIR/catenet` or `~/.cache/catenet/run` (directory
  0700, so only the user can connect), named `catenet-<hash of repo path>.sock` (Windows: a named pipe, untested).
  State in `<repo>/.catenet/daemon.json`, log in `<repo>/.catenet/daemon.log`.
- **API:** `GET /health` (version, build id, pid, watching, last index and its error), `POST /index` (`{full}`),
  `POST /shutdown`, and from M3 `POST /hook` (2.4, 2.6). There is no TCP listener (ADR-0015 dropped the loopback
  `http` hook plan).
- **Freshness:** a chokidar watcher that skips ignored directories signals changes, and only changes to files that can
  affect the graph count (code, manifests, tsconfig, JSON/TOML config, removed directories); logs and caches don't.
  Runs are debounced (200 ms) and serialised; changes during a run trigger exactly one follow-up run. Indexing runs in
  a **worker thread**, so the socket answers within milliseconds even mid-index (required for M3's hook path).
- **Lifecycle:** `ensureDaemon` reuses a daemon with the same build id, replaces one from another build (and reports
  failure, not success, if the old one won't exit), cleans up a stale socket or dead pid (crash, `kill -9`), and
  spawns a detached one otherwise; it never throws to callers. A process is only ever signalled after its command line
  proves it is our daemon for this repo (a stale pid may belong to an unrelated process). The MCP server calls
  `ensureDaemon` at start and heartbeats every 5 minutes. A daemon exits after 60 idle minutes.
- **Socket ownership:** each daemon binds a private path and renames it onto the shared one (Node deletes a unix socket
  by path when its server closes, so an exiting old daemon could otherwise delete a newer one's socket); the loser of
  a start race exits. Clients never pool connections (`agent: false`), so a request always reaches the current owner.
- **Failure:** an index error is logged and reported by `/health` and `catenet doctor`; the daemon keeps serving. If
  `events.db` can't be opened, hooks get empty answers (retried every 30 s) and the daemon keeps serving. Request
  bodies over 1 MB are dropped.
- **Two installs, one daemon:** the build id is version + install (`plugin` bundle or `workspace` build) + binary
  mtime. A client reuses a daemon of the same build or of the other install at the same version, and replaces any
  other, so the workspace CLI and the plugin don't keep replacing each other's daemon. Stopping escalates from
  `/shutdown` to SIGTERM to SIGKILL (a daemon whose event loop is blocked never runs its SIGTERM handler), only for a
  process whose command line proves it is a Catenet daemon for this repo.

### 2.13 Claude Code plugin (`plugins/claude-code`), M3
One-step install (ADR-0015). Sources: `.claude-plugin/plugin.json`, `hooks/hooks.json` (exec form,
`node ${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs claude-code`), `.mcp.json` (`node ${CLAUDE_PLUGIN_ROOT}/dist/catenet.mjs mcp`).
`pnpm build:plugin` (`scripts/build-plugin.ts`, esbuild) bundles `dist/catenet.mjs` (CLI and MCP), `daemon.mjs`,
`index-worker.mjs`, `hook.mjs` and the tree-sitter `.wasm` files, so the plugin needs nothing outside its directory;
runtime paths resolve next to the running bundle first, then the dev `dist/`. A plugin added from a local checkout
runs in place from `plugins/claude-code/`; one from a hosted marketplace would be copied to Claude Code's cache (a test
runs the bundle from such a copy). The build swaps the new `dist/` in with renames, so a running session never sees a
half-written one; tests build into `node_modules/.cache/catenet/plugin-test/` instead.

Install from a checkout (`dist/` is git-ignored, so it must be built first):
1. `pnpm install && pnpm build:plugin`
2. in Claude Code: `/plugin marketplace add <path to the checkout>`, then `/plugin install catenet@catenet` (or
   `claude --plugin-dir plugins/claude-code` for one session);
3. in each repository: `node <checkout>/plugins/claude-code/dist/catenet.mjs init` (or the workspace CLI).

The hooks and MCP server run `node` from PATH, which must be Node 24+ (`catenet doctor` checks it). Installing the
plugin changes nothing until a repository runs `catenet init`. `plugin.json`'s `version` must be bumped on every
release, since hosted installs are cached by version.

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
- Daemon listens only on a unix socket in a user-private (0700) directory; no TCP listener for hooks or MCP, no remote
  access. (The M7 UI's transport is decided in M7; see 2.9.)
- No network egress. No telemetry.
- Event log redaction; opt-in for storing contents.
- Prompt-injection hygiene for anything written into agent-visible text (guidance, injected context, error messages).
- Policy, spec and hook files are covered by the built-in `self-protection` rule (see 2.5).
- `.catenet/` git-ignored except `policy.yaml`, by its own `.gitignore` written by `catenet init` (generated guidance
  lives in `AGENTS.md`, outside it).
- Agents are affected only in repositories that opted in with `catenet init` (`.catenet/config.json`, which is
  git-ignored, so a cloned repository can't opt anyone in); elsewhere the plugin's hooks and MCP server do nothing.
  Plain `catenet index` or `daemon start` creates `.catenet/` (with its `.gitignore`) but doesn't opt in.
- Injected context quotes every repository-derived string as a JSON literal after removing control, format
  (zero-width, bidi, tag) and line-separator characters, with per-item caps.

## 6. Later: anchored memory (M9)
Memories are nodes of kind `memory` with anchors: `{path, symbol, region_hash, commit}`. Recall re-resolves the symbol and re-hashes:
unchanged → `fresh`; changed → `stale` (still returned, clearly flagged); missing → `orphaned`. Whitespace-only changes don't invalidate;
moved symbols re-anchor by name. Contradictions between memories are detected and resolved by recency/confidence with the loser marked superseded.
Memories carry provenance (who/what recorded them) and are treated as untrusted data when injected. Writes come from the agent via a tool
and from humans via `AGENTS.md`; they are never edits to the derived graph.
