# Roadmap

Rules: one milestone at a time. Each ends with a demo, passing tests, updated docs, and a **stop for human review**.
Each milestone lists acceptance criteria that can be checked, not just described.

## M0. Spike and foundations
**Status:** done 2026-10-04, awaiting owner review. Results: `docs/HOOK_SCHEMAS.md`, ADR-0005 to ADR-0012,
`spikes/README.md`, `fixtures/`. Competitor installs (RESEARCH.md) moved to M4.

**Goal:** remove unknowns before building.
- Fetch CURRENT official docs for Claude Code hooks (events, payloads, response formats incl. allow/ask/deny and
  additional-context output, plugin packaging, CLAUDE.md imports) and Codex CLI hooks; write `docs/HOOK_SCHEMAS.md` with
  exact JSON examples and links.
- Confirm MCP TypeScript SDK usage and tree-sitter binding choice (native vs WASM) with a tiny working spike each.
- Repo skeleton (pnpm workspace, lint, Vitest, CI), `docs/DECISIONS.md`, `docs/BACKLOG.md`.
- Create 3 fixture repos (TS, Python, mixed monorepo) with seeded hidden dependencies and answer keys.
- Latency spike: measure cold start of a Node hook script vs. a thin socket client; record numbers in an ADR.
- **Blast-radius counting ADR**, written before the answer keys (they depend on it): what a `package` node is; `external`
  (third-party) vs. local imports we failed to resolve; which edge kinds make something a dependent, how deep, and whether
  counts are in files or symbols; how `public_api` is decided. (Done: ADR-0008, which renames it `published_api`.)

**Acceptance:** HOOK_SCHEMAS.md exists with verified examples; `pnpm test` runs green on an empty-but-wired suite; fixtures have answer keys;
ADRs record runtime/license/name decisions made with the owner.

## M1. Code graph indexer
**Status:** done 2026-10-07, awaiting owner review. Answer keys reproduced exactly on all three fixtures
(`packages/core/test/acceptance.test.ts`); single-file reindex p95 230-426 ms on 2,011 files
(`packages/core/bench/RESULTS.md`); incremental updates equal full rebuilds (`test/incremental.test.ts`); ADR-0013.

- Tree-sitter extraction for TS/JS and Python: files, symbols, imports, calls (best-effort), contains, tests edges.
- SQLite store, incremental update by content hash, `external` nodes for unresolved imports.
- CLI: `catenet index`, `catenet deps`, `catenet dependents`, `catenet impact` (counts + evidence).

**Acceptance:** on fixtures, dependents/dependencies match answer keys at agreed recall (target: 100% for exact-edge cases;
heuristic cases reported separately); single-file incremental reindex < 1 s on a 2k-file synthetic repo; heuristic edges are marked as such.

## M2. MCP server and daemon
**Status:** done 2026-10-07, awaiting owner review. Daemon with watcher and clean restart, MCP server with 7
read-only tools, `catenet doctor`; process-level tests in `packages/daemon`, `packages/mcp`, `packages/cli`; update
path p50 120 ms after profiling-led speedups (`packages/core/bench/RESULTS.md`); ADR-0014. The query cache was not
built: queries already take 20-50 ms (ADR-0014). End-to-end: headless Claude Code 2.1.287 connected to `catenet mcp` on
fixtures/ts-basic, called `get_dependents` and `tests_for`, and answered with exactly the answer key's 8 direct / 3
indirect dependents and the reaching test. (It also over-generalised that no dependent was tested, having skipped
`impact_of`: evidence for M3's proactive context injection.)

- Long-lived daemon (socket), file watcher, query cache.
- MCP server with read-only tools (see ARCHITECTURE 2.7), bounded responses.
- `catenet doctor`.
- Make the update path cheaper for the watcher (deferred from the M1 review). Done after profiling: `export *`
  resolution pruning and changed-rows-only `published_api` writes; limiting the add/delete resolution comparison
  (~28 ms) was measured and not worth it.

**Acceptance:** Claude Code can connect to the MCP server and answer structural questions on fixtures; tool responses
bounded and deterministic; daemon restarts cleanly; `doctor` reports healthy/unhealthy accurately.

## M3. Events and Claude Code hooks (record only, no gating)
**Status:** done and approved by the owner 2026-10-07 (including the code review fixes). ADR-0015 (command hooks everywhere, superseding ADR-0012's `http`
plan; async recording hooks; opt-in via `catenet init`; context injection on by default; self-contained plugin bundle).
Evidence:
- **Real sessions:** Claude Code 2.1.287 in `-p`, plugin loaded with `--plugin-dir` on a copy of fixtures/ts-basic.
  `catenet report` listed 6 of 6 tool calls (Read, Edit, Write, Bash), diffs for all 3 edited files (none partial), and
  1 compaction. Claude quoted the injected blast-radius context in its answer.
- **Latency:** in-session, p50 42 ms and p95 59 ms over the 21 hooks the daemon answered, measured from hook process
  start to the daemon's answer (so excluding Claude Code's spawn cost and Node's exit; client-side failures weren't
  counted yet in that run). The closest end-to-end number is the benchmark, timed from spawn to exit: p95 88 ms for a
  hub edit with context on 2,011 files (`packages/adapters/claude-code/bench/RESULTS.md`).
- **Code review (2026-10-07):** 32 findings fixed, including a daemon hang on pipe/device targets, a crash on an
  unopenable `events.db`, heredoc bodies in the log, redaction gaps, daemon replacement between the workspace and
  plugin installs, and injection hygiene for repository text; each has a test.
- **Fault injection:** `packages/daemon/test/hook-client.test.ts` covers daemon down, slow daemon, malformed stdin,
  garbage response, Node < 24, and a repository that hasn't opted in. The client always exits 0 within its cap.
- **Resolved:** session id is kept across `--resume` and `/compact` (HOOK_SCHEMAS 8). Still open: the id across
  `/clear` (needs an interactive session) and `ask` under each permission mode (M5, when Catenet first emits `ask`).

- Neutral event schema + recorder. Claude Code adapter registers command hooks (ADR-0015, superseding ADR-0012's
  `http` plan); **no blocking** yet.
- Record real hook payloads into contract-test fixtures and resolve the UNCONFIRMED items in `HOOK_SCHEMAS.md` (session id
  across `/clear` and compaction, `ask` under each permission mode).
- Secrets redaction; privacy defaults per ARCHITECTURE 2.4.
- `catenet report --session last`.
- Define `tool_calls.outcome` values from what the hook payloads in `HOOK_SCHEMAS.md` actually expose.
- Plugin packaging for one-step install; consent is per repository via `catenet init` (ADR-0015).

**Acceptance:** a real Claude Code session produces a complete record of tool calls and diffs; hook failures never affect the
agent (fault-injection tests: kill daemon, slow daemon, malformed payload); warm hook p95 < 100 ms measured end to end inside
Claude Code (S4 measured transport only).

## M4. Evaluation harness (v0). Do this BEFORE the gate
**Status:** done 2026-10-08, awaiting owner review. `packages/eval` + `catenet eval run|report|lock`, the runnable
`fixtures/eval-shop` suite (7 tasks), ADR-0016, pre-registration (`packages/eval/PREREGISTRATION.md`, `suite.lock.json`).
First pre-registered run: `packages/eval/results/20261007-232450-claude-code/` (280 Claude Code sessions on
claude-sonnet-5-5, 278 valid; $27, about $35 with the pilots, of the $50 budget). Deviations, listed in the report:
Claude Code updated itself from 2.1.287 to 2.1.293 partway through, the pre-registration was not committed, and the
run was interrupted and resumed on the same schedule.
- **H1 supported:** edit tasks passed without breaking a dependent Catenet can see in 86% of sessions without Catenet
  and 100% with it, effect +0.14 [+0.08, +0.20] (97.5% CI). The whole effect comes from one task
  (`signature-via-reexports`: 9/20 vs 20/20). The other three edit tasks passed in every session in both conditions.
  Every failing baseline session left type errors that `npm run typecheck` would have shown, so this shows Catenet
  getting the agent to fix callers the type checker would flag, not catching what it can't.
- **H2 supported:** question tasks used 34% fewer tokens with Catenet [−41%, −25%] (97.5% CI), recall unchanged
  (−0.01 [−0.05, +0.02]); −48% on `q-tests-for`, where the agent used Catenet's tools, and −15% on `q-dependents`,
  where it didn't.
- **Cost of Catenet while editing:** +11.5% tokens [+3.9%, +19.5%] (95% CI, descriptive). Cost per session was the
  same or slightly lower (cache reads are cheap).
- **Control:** no measurable difference for the dependent no static graph can see (16/20 vs 12/20 sessions,
  −0.20 [−0.45, +0.10]).
- **Code review (2026-10-08):** 24 findings, none changing the recorded numbers. Fixed: the injected note could be cut
  mid-quote with long paths; a regression for symlinked files inside a repo; `events.db` backups could be
  overwritten; and harness robustness. The harness changes are: `--out` can't overwrite results; plan-limit and auth
  errors count as infrastructure, not agent failures; the whole process group is killed on timeout; resume checks
  provenance and re-runs errors; daemons are stopped on harness errors; the binary is pinned and auto-update is off;
  account connectors are off; the grader uses the checkout's `tsc`; and "Supported" is directional.
- **Hook latency in session:** median per-session p95 59 ms, 90th percentile 90 ms; 11 of 138 Catenet sessions had a
  p95 above 100 ms (worst 1,154 ms); 0 hook failures.
- **Found and fixed by the pilots:** edit context never fired for paths through a symlink (macOS `/var`), and the
  injected note named MCP tools with the wrong prefix for a plugin install. The note now lists up to 8 dependents,
  untested first (owner decision).
- **Limits** (packages/eval/README.md): one small synthetic repository written by Catenet's authors, one model, three
  of four edit tasks at ceiling, and a suite hardened after the first pilot (disclosed in the pre-registration).

- `packages/eval`: runs scripted tasks on fixture repos with and without Catenet (headless agent runs where feasible).
- Metrics: broken-dependent rate (tests/typecheck failing after the edit), tokens and tool calls, gate false-positive rate (labeled), latency.
- Design for rigor: pre-registered task list, multiple seeds/trials, paired comparisons, report effect sizes **with confidence intervals**,
  publish the raw data. Note the ecosystem already contains headline numbers whose confidence intervals touch zero; ours must not
  overclaim.

**Acceptance:** `catenet eval` reproduces a baseline on fixtures end-to-end with one command; results written to a versioned JSON/Markdown report;
a README explains the methodology and its limits.

## M5. Safety gate
- Policy engine, per-rule `on_match` (`record_only | tell_agent | ask_human | block`, ADR-0003), rules in `.catenet/policy.yaml`, blast-radius scoring, protected paths, policy self-protection.
- Claude Code `PreToolUse` integration returning allow/ask/deny plus additional context (dependents/tests).
- `catenet why`, decision evidence, conservative Bash handling.
- Intra-file call edges (deferred from M1, ADR-0013), so symbol-level evidence includes callers in the same file.
- Decide which edges may cause `block` (today: anything but `inferred`; consider excluding `heuristic` too), using M4 data.
- Off-task detection (rule `off-task`) as **experimental, capped at `tell_agent`** (may be deferred if time-boxed).

**Acceptance:** on fixtures, seeded high-impact edits are flagged, seeded protected-path edits blocked when their rule is `block`; `record_only` rules never change agent
behavior; every decision has evidence; false-positive rate measured with M4 and recorded; fail-open verified.

## M6. Guidance generator and drift check
- `catenet guidance --write` (root + optional per-directory), marker-based regeneration, token budget, diff preview.
- `catenet guidance --check` for pre-commit/CI; stale claims reported with reasons.
- `CLAUDE.md` import of generated file.
- `get_hotspots` MCP tool and the `metrics` table (fan-in x git churn x untested), which the `hotspots` section needs
  (moved from M2 by the owner, 2026-10-07).

**Acceptance:** hand-written text outside markers is never modified (property tests); renaming/removing a referenced file in a fixture makes `--check` fail
with the correct section named; generated file stays within budget; untrusted strings are escaped (injection test cases included).

## M6A. Architecture layer (declared components and architecture rules)
- Spec file schema (`catenet.spec.yaml`), loader, validation (`catenet spec check`), components via path globs, `belongs_to` edges, rolled-up `component_depends_on`.
- Architecture rule kinds: `forbid_dependency`, `allow_only`, `entrypoint_only`, `no_cycles`, `forbid_external`. `violations()` query with offending edges as evidence.
- Per-file context injection (component, governing architecture rules) at `PreToolUse`/`SessionStart`; post-edit violation feedback to the agent; policy-engine integration (per-rule `on_match`; `inferred` never blocks).
- Self-protection: the built-in `self-protection` rule also matches spec files (raise it to `ask_human` to require approval).
- `catenet spec init --from-repo` (proposal of components for human review); `/catenet-spec` slash command that drafts spec files (diff, never writes the graph).

**Acceptance:** on fixtures with seeded violations (incl. via re-exports/barrels), detection precision/recall are measured and recorded; post-edit feedback reaches the agent in a real session;
`record_only` never changes behavior; `spec check` catches bad globs/duplicate IDs/missing refs; spec text injected into agent context is quoted, capped and escaped (injection tests).

## M6B. Requirements layer (traceability and spec drift)
- `requirement`/`adr` nodes; `satisfies`/`verifies`/`governs`/`decided_by`/`refines` edges with provenance (`declared|tagged|inferred`).
- Native YAML requirements + plain-Markdown (`### REQ-XXX`) + ADR import; one spec-tool adapter chosen with the owner (verify its current layout first).
- Queries/tools: `trace_requirement`, `get_requirements_for`, `spec_coverage`, `impact_of_requirement`.
- Requirement-aware risk weight (`w7`) and evidence in gate decisions and `catenet why`.
- Spec drift checks (stale references, weakly verified requirements, superseded ADRs); `architecture` and `requirements` sections in generated `AGENTS.md`.
- `catenet spec suggest-links` → `.catenet/proposals/` and `catenet spec accept`.

**Acceptance:** traceability matches the fixture answer key at agreed accuracy (reported per provenance type); gate evidence cites requirements for seeded high-risk edits;
removing a referenced test/path in a fixture makes the drift check fail with the right item named; inferred links never produce `block`; proposals never enter the graph until accepted into spec files.

## M7. Visualization v1
- Daemon-served read-only UI: blast-radius map with live session overlay and "why" panel; static HTML export.
- Define what node color encodes ("risk" is undefined; likely blast-radius score).
- If M6A/M6B are done: component-level map with violations, and a requirement trace view (see SPEC_LAYER 5.7).

**Acceptance:** works on the 2k-file synthetic repo without freezing (focused neighborhood, node cap); live overlay reflects a real session within ~1 s;
no write endpoints exist (verified by test); bound to loopback/socket with token.

## M8. Codex adapter
- Codex hook config + adapter reusing the core; same neutral events; contract tests with recorded payloads; strict output schema compliance.
- Decide how `ask_human` maps to Codex, which has no working `ask` (deny with a "needs human approval" reason, or downgrade to
  `tell_agent`); record as an ADR.
- Parse `apply_patch` text to get edit target paths (confirm the patch grammar from the Codex schema files first).
- Install docs for Codex hook trust review (`/hooks`).
- Cross-agent run comparison in the report (and later UI).

**Acceptance:** the same fixture task is recorded and gated in both agents with equivalent decisions; adapter contract tests pass; install is one command.

## M9. Anchored memory (post-MVP)
- `remember` / `recall` / `stale_report`; anchors, freshness states, contradiction handling, provenance; injection at relevant file touches and after compaction.
- Feeds `verified-notes` into generated guidance (fresh only).

**Acceptance:** edit the anchored function → memory returns `stale`; delete it → `orphaned`; whitespace/move does not invalidate; injected memories are escaped and length-limited.

---

## Evaluation plan (applies from M4 onward)
**Questions we must answer with data:** Does Catenet reduce broken dependents? Does it cut tokens/tool calls on structural tasks? What is the gate's false-positive
rate? What is the latency overhead?

**Task design:** (a) refactor shared helper with hidden dependents; (b) rename/move a published API; (c) change a function signature used via re-exports;
(d) edit near protected paths; (e) structural questions ("what calls X?") for token measurement; (f) off-task temptation tasks for off-task detection; (g) edits that introduce forbidden component dependencies (post-edit feedback fix rate); (h) edits to code satisfying high-risk requirements; plus traceability accuracy vs an answer key (see SPEC_LAYER 10).
**Protocol:** fixed task list written before running; N≥10 trials per task per condition where cost allows; randomized order; same model/version recorded;
report mean effect and 95% CI; keep failures in the dataset; separate "exact-edge" from "heuristic-edge" cases.
**Reporting:** claims in README/marketing must link to a report produced by `catenet eval`.

## Definition of done for the MVP (M1 to M8; M6A/M6B may follow the MVP if scope must be trimmed)
A developer can run one command to install; their Claude Code (and Codex) sessions are indexed, recorded and (optionally) gated; they can open a map that shows
what the agent touched and why a decision was made; they can generate and drift-check an `AGENTS.md`; and the repository contains a reproducible benchmark
showing what the layer does and does not improve.

## Open questions (decide with the owner; record as ADRs)
1. ~~Project name and package namespace.~~ Resolved: Catenet (ADR-0007).
2. ~~License (MIT vs Apache-2.0).~~ Resolved: MIT (ADR-0006).
3. ~~Hook client implementation: Node script vs small compiled binary.~~ Resolved: plain-JS Node command client for every hook (ADR-0012, ADR-0015).
4. Is `policy.yaml` committed by default (team-shared) or local by default? (Recommendation: committed, with local override.)
5. Default Bash handling strictness.
6. How much of an agent's prompt text to store (default: hash + redacted preview).
7. Do we ship a hosted/remote MCP mode later (needed for chat apps)? Out of scope for MVP.
8. Monorepo support depth for per-directory `AGENTS.md`.
9. Spec layer: native YAML only, or also an adapter for the owner's spec tool? Where do specs live, and what ID convention? (See SPEC_LAYER 11.)
10. Is post-edit violation detection acceptable as the guaranteed path in v1, with pre-edit as best-effort?

## Backlog (explicitly not now)
See `docs/BACKLOG.md`.
