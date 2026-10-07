# M3 hook latency

ROADMAP M3 acceptance: **warm hook p95 < 100 ms.** Met on the benchmark below. The real in-session check is recorded
in ROADMAP (M3 status).

Recorded 2026-10-07 on an Apple M1 Pro, macOS 26.5.1, Node v24.21.0. Reproduce with
`pnpm build:plugin && node packages/adapters/claude-code/bench/hook-bench.ts`.

## Method
- Uses the built plugin, exactly as Claude Code runs it: the bundled daemon (started by `catenet init`) on the
  2,011-file synthetic repo from `packages/core/bench/generate.ts`, then `node hook.mjs claude-code` per hook.
- Each hook is timed from process spawn to exit, which includes Node start-up (~40 ms of every number below).
- Hub-file edits use a fresh session per call, so the context is computed every time. That is the worst case: a real
  session explains each file once.

## Results

| hook | n | p50 ms | p95 ms | max ms | with output |
|---|---|---|---|---|---|
| PreToolUse Edit, hub file (~1,800 dependents), context injected | 50 | 82 | 88 | 102 | 50/50 |
| PreToolUse Edit, leaf file, no context | 50 | 61 | 67 | 87 | 0/50 |
| SessionStart, repo map injected | 50 | 73 | 80 | 89 | 50/50 |
| PostToolUse (runs async in Claude Code) | 50 | 63 | 66 | 71 | 0/50 |

## History
The first run measured the hub case at **p95 115 ms**, over budget. Injected context had reused the full `impact()`
query, which walks evidence and resolves each of ~1,800 dependents' packages one query at a time.
`Graph.impactSummary` computes the same counts in one recursive query; a test checks it equals `impact()` for every
answer-key target. Result: p95 115 to 85 ms.

Re-run after the M3 code review fixes (quoted context, stricter opt-in lookup, payload stripping, flavoured build
ids): the table above. The hub case moved from p95 85 to 88 ms, within run-to-run noise and the budget.
