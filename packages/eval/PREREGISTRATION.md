# Pre-registration: eval-shop v0

Written on 2026-10-07, before the full run, after two exploratory pilots that were used only to calibrate the suite
(described at the end). [`suite.lock.json`](suite.lock.json) records the suite hash and run parameters; a report whose
suite, trials, model, turn limit or seed differ is marked exploratory and can't back these claims. Method and limits:
[README.md](README.md). Design: ADR-0016.

## Hypotheses
- **H1 (edit tasks):** with Catenet, Claude Code more often completes a change to shared code without breaking a
  dependent that a code graph can see (`passed_without_breakage`).
- **H2 (question tasks):** with Catenet, Claude Code uses fewer total tokens (`tokens_total`) answering structural
  questions, without losing recall.

## Design
- **Suite:** `fixtures/eval-shop` (7 tasks):
  - 4 primary edit tasks: `signature-via-reexports`, `boolean-to-result`, `rename-published-api`, `move-module`;
  - 1 control edit task: `leaf-control`;
  - 2 question tasks: `q-dependents`, `q-tests-for`.
- **Conditions:** `baseline` (Claude Code alone) and `catenet` (Claude Code with the Catenet plugin after
  `catenet init`). Both use identical flags and an identical prompt.
- **Runs:**
  - 20 trials per task per condition: 140 blocks, 280 sessions.
  - Blocks are shuffled with seed 2026, and each block runs both conditions back to back in random order.
- **Agent:** Claude Code 2.1.287, `--model claude-sonnet-5-5`, `--max-turns 40`, subscription authentication, concurrency 1.
- **Cost:** the run stops between blocks if the agent cost reaches $41 (the owner's $50 budget minus the pilots).

## Metrics
- **H1:** per run, 1 when the held-out acceptance test passes and no `exact` or `heuristic` dependent breaks (held-out
  test fails or type errors in its file), else 0. `none`-edge controls are excluded and reported separately.
- **H2:** per run, input + output + cache creation + cache read tokens over all models (`modelUsage`).
- **Guard for H2:** the difference in recall against the task's answer.

## Analysis
- **Effect:**
  - H1: the mean over the 4 primary edit tasks of (catenet rate − baseline rate).
  - H2: the mean over the 2 question tasks of log(mean catenet tokens / mean baseline tokens), reported as a percent
    change.
- **Interval:** a stratified percentile bootstrap (tasks fixed, runs resampled within each task and condition, 10,000
  resamples, seed 2026), at 97.5% (Bonferroni for two hypotheses).
- **Decision:**
  - H1 is supported if its interval lies entirely above 0.
  - H2 is supported if its interval lies entirely below 0 and the 97.5% interval of the recall difference has a lower
    bound above −0.1.
  - An interval that includes 0 is reported as "no measurable effect", not as evidence of no effect.
- **Exclusions:** only `invalid` runs, where isolation failed (the session's `system/init` doesn't match its condition,
  or a tool call touched the task files), and infrastructure errors after 2 retries. Both are counted and reported.
  Agent failures (turn limit, timeout, wrong edits) are kept.
- **Descriptive only:**
  - dependents broken by edge label (`none` = the control Catenet can't see);
  - task completion, precision, cost, turns, tool calls by tool;
  - the share of catenet runs where context was injected;
  - hook latency;
  - the leaf-control task;
  - per-task results.

## Added after registration
- **2026-10-07, during the full run, before any analysis (owner request):** a descriptive result for total tokens on
  the primary edit tasks (log ratio as a percent change, 95% interval). The owner counts tokens as a success measure
  alongside H1. It is reported next to H1 but is not a hypothesis of this registration; v1 of the suite should
  pre-register it.

## Deviations during the registered run
- **Claude Code updated itself mid-run** (found by the M4 code review): `~/.local/bin/claude` was re-pointed from
  2.1.287 to 2.1.293 at 2026-10-08T04:53:05Z, 4.5 minutes after the resume. Roughly 60% of sessions (most of those
  after the resume) ran on 2.1.293, while the design above names 2.1.287. Sessions didn't record their version then,
  so this can't be split exactly. An approximate split before and after points the same way on every primary
  measure. The harness now pins the binary, turns auto-update off and records each session's version.
- **Not committed:** this file and `suite.lock.json` were written before the full run (the lock at
  2026-10-07T23:24:41Z, the run started 9 seconds later) but not committed, so git can't prove their timing, and the
  code under test is recorded as `0d8ca56+dirty`. Future runs commit both, and the code, first.
- **Interrupted and resumed:** the owner went offline after 96 of 280 sessions. The run was stopped cleanly between
  sessions, and the harness gained `--resume` (same seed, same schedule, finished sessions kept) and a network wait.
  The rest of the schedule then ran with the same lock and the same plugin bundle (built at registration time). The
  report records the resume time.
- **2 invalid sessions:** both `boolean-to-result` catenet runs, where the owner's claude.ai account connectors
  (Claude Docs, Google Drive, Gmail, Google Calendar) loaded into the session. The isolation check excluded them as
  pre-registered. Both had passed, and the task was at 100% in both conditions, so excluding them changes no result.

## Minimum detectable effect (honest expectations)
- **H1:** in the pilots, three of the four primary edit tasks passed in every session in both conditions. If that
  holds, all of H1's variance comes from one task.
  - With 20 runs per condition, the 97.5% interval on the averaged effect is roughly ±0.08 to ±0.16 wide.
  - So H1 detects an averaged effect of about 0.1 or more, which is a change of about 0.4 or more on a single task if
    the others don't move.
- **H2:** pilot runs varied by about 0.3 in log tokens. With 20 runs per condition, the interval on the mean log ratio
  is about ±0.15, so changes smaller than about 15% won't be detectable.

## Calibration before this registration (exploratory, not analysed)
- **Pilot 1** (N=3, 42 sessions, $3.74):
  - Three of four edit tasks passed in every session in both conditions.
  - It also found two Catenet defects, now fixed: edit context never fired when paths went through a symlink, and the
    injected text named MCP tools with the wrong prefix.
- **Changes after pilot 1:**
  - The suite was hardened: about 360 files, look-alike names, two levels of renamed re-exports, more CommonJS
    consumers, and prompts without the "make sure everything still works" nudge.
  - The injected note was changed to list up to 8 direct dependents, untested ones first (owner decision).
- **Pilot 2** (N=3, 42 sessions, $3.81): context fired before edits, and the agent called Catenet's MCP tools on the
  question tasks.
  - The template-import control broke in every session in both conditions, which pinned `signature-via-reexports` at 0
    under the original metric. The primary metric was therefore changed to exclude `none`-edge controls (owner
    decision).
  - Three edit tasks still passed in every session; they stay in the suite unchanged.

No pilot data enters the analysis.
