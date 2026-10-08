# @catenet/eval

The benchmark harness (ROADMAP M4). It runs the same pre-registered tasks with and without Catenet and reports paired
effects with confidence intervals. Claims about Catenet in any README or announcement must link to a report it produced
(ROADMAP "Evaluation plan"). This page explains the method and, as importantly, its limits.

## What it asks
1. **Edit tasks:** when an agent changes shared code, does Catenet's injected context make it less likely to break the
   code that depends on it?
2. **Question tasks:** when an agent answers a structural question ("what calls X?"), does Catenet cut the tokens it
   spends without hurting the answer?

## Results
The first pre-registered run (v0 suite, `claude-sonnet-5-5`, 280 sessions) is in
[`results/20261007-232450-claude-code/`](results/20261007-232450-claude-code/report.md). It ran with deviations
listed at the top of the report: Claude Code updated itself from 2.1.287 to 2.1.293 partway through (about 60% of
sessions on 2.1.293), the pre-registration was written beforehand but not committed, and the run was interrupted
and resumed.

| Measure | Without Catenet | With Catenet | Effect [interval] |
|---|---|---|---|
| Edit tasks done without breaking a visible dependent (H1) | 86% | 100% | +0.14 [+0.08, +0.20] (97.5%) |
| Question-task tokens (H2) | 210k | 131k | −34% [−41%, −25%] (97.5%) |
| ・ `q-tests-for` | | | −48% [−56%, −39%] (95%) |
| ・ `q-dependents` | | | −15% [−24%, −5%] (95%) |
| Question recall | 0.94 | 0.92 | −0.01 [−0.05, +0.02] |
| Edit-task tokens (descriptive) | 138k | 153k | +11.5% [+3.9%, +19.5%] (95%) |
| Control dependent broken, on the task that has one | 16/20 | 12/20 | −0.20 [−0.45, +0.10] (95%) |

The Without/With columns are pooled means; the effects are means of per-task effects (the pre-registered estimate),
so they can differ (−34% vs a pooled −38%).

Both pre-registered hypotheses are supported. What that does and doesn't mean:
- **One task carries H1.** It comes entirely from `signature-via-reexports` (9/20 vs 20/20); the other three edit tasks
  passed in every session in both conditions.
- **The breaks H1 counts are ones the type checker would flag.** All 11 failing sessions without Catenet left type
  errors in `badge.ts` and `receipt.ts` (typed callers of the renamed `price`/`displayPrice`); their CommonJS
  consumer broke only alongside them. Every session with Catenet type-checked clean. So H1 shows that Catenet's note
  got the agent to update the callers it would otherwise leave broken, the same callers `npm run typecheck` would
  have pointed to. It does not show Catenet catching what the type checker can't. A v1 comparison with a "run the
  type checker" nudge in the baseline prompt is in the backlog.
- **H2 is uneven.** About half the saving comes from `q-tests-for`, where the agent used Catenet's `tests_for` and
  `get_dependents` tools. On `q-dependents` the agent never called a Catenet tool; the smaller saving there came
  from the session-start map alone.
- **Catenet costs tokens while editing** (about +11%), mostly in extra turns spent checking and fixing the dependents
  it names. Cost per session came out the same or slightly lower (cached tokens are cheap).
- **The control shows no measurable difference** (16/20 vs 12/20, interval includes 0). That is consistent with the
  effect coming from what the graph shows the agent, but it can't rule out general caution: the control breaks only
  at runtime, and a text search finds it.
- **`q-dependents` recall** (0.85–0.88) is held down almost entirely by `src/reports/export.ts`, which the answer
  counts as calling `formatPrice` although it only does so through a generic exporter. That answer is debatable; it
  stays as registered and is revisited in v1.
- Read the limits below before quoting these numbers.

## How a run works
- **Suite:** [`fixtures/eval-shop/`](../../fixtures/eval-shop) is a runnable TypeScript repository of about 360 files
  (about 300 of them noise modules and look-alike names such as `formatPriceRange`) with no dependencies. Its `tasks/` directory holds 7 tasks (table below). Prompts, held-out tests and patches live outside
  `repo/`, so the agent never sees them.
- **Conditions:**
  - `baseline`: Claude Code with no Catenet;
  - `catenet`: the same, after `catenet init`, with the Claude Code plugin loaded (hooks, injected context, MCP tools).
  - Both conditions use identical flags (except `--plugin-dir`) and an identical prompt that never mentions Catenet.
- **Block:** one baseline run and one catenet run of the same task, back to back in a random order. Blocks are shuffled
  with a recorded seed. Pairing by block controls for drift during the run.
- **One run:**
  1. Copy the repo to a temporary directory, `git init` it, and link the workspace's `tsc`.
  2. Condition `catenet` only: run `catenet init`.
  3. Run one headless session (`claude -p`, stream-json output).
  4. Grade the result: type-check it, then copy in the held-out tests and run them.
  5. The repository copy is deleted.
- **Isolation:** each session ignores your own configuration:
  - `--setting-sources project` (no user or local settings);
  - `--settings '{"disableClaudeAiConnectors":true}'` (no claude.ai account connectors; added after the first run);
  - a minimal inherited environment, auto memory off, auto-update off (`DISABLE_AUTOUPDATER=1`, added after the first
    run), and the `claude` binary pinned by its real path for the whole run;
  - no `--strict-mcp-config`: it also drops the plugin's own MCP server.

  The session's `system/init` event is checked:
  - a baseline run that loaded Catenet is invalid;
  - a catenet run without a connected Catenet server is invalid;
  - so is any run that loaded another plugin or MCP server, or whose tool calls or tool results touched the task files
    or held-out tests.

  Each session's own reported Claude Code version is recorded; a run that mixes versions is exploratory.

  Invalid runs stay in `raw.jsonl` with the reason and are left out of the analysis.
- **Failures:**
  - Infrastructure errors (API errors, crashes) are retried up to twice and then recorded as errors.
  - Hitting the turn limit, timing out or making a wrong edit counts against the agent and is kept.

## Tasks (v0)
| Task | Kind | What a careless change breaks (some of it only at runtime, invisible to `tsc`) |
|---|---|---|
| `signature-via-reexports` | edit | a CommonJS consumer two renamed re-exports away (`displayPrice`); a template `import()` (control) |
| `boolean-to-result` | edit | callers that test the result for truthiness, one under a renamed import; a CommonJS consumer |
| `rename-published-api` | edit | a CommonJS member access; a caller using the deprecated alias |
| `move-module` | edit | two CommonJS `require()`s of the old path |
| `leaf-control` | edit (control) | nothing: it measures harm and overhead, outside the primary analysis |
| `q-dependents` | question | answer: the 6 files that call `formatPrice`, under any name |
| `q-tests-for` | question | answer: the 2 test files that exercise `checkout/total.ts` |

Each dependent is labelled by how Catenet's graph reaches it:
- `exact`: Catenet can tell the agent about it.
- `none`: a control Catenet can't see, such as a template `import()`.
- `heuristic`: no v0 task has one; the report says "no data" rather than leaving the row out.

## Metrics (pre-registered in [PREREGISTRATION.md](PREREGISTRATION.md))
- **Primary 1, edit tasks: `passed_without_breakage`.** The held-out acceptance test passes and no dependent that a
  code graph can see breaks, meaning its held-out test fails or its file has type errors. An agent that does nothing
  fails acceptance, and one that does the task but breaks such a dependent also scores 0. `none`-edge controls are
  reported separately ("dependents broken, none edges"): in the pilot the control broke in every session in both
  conditions, so counting it would pin that task at 0 for both.
- **Primary 2, question tasks: `tokens_total`.** Input + output + cache creation + cache read tokens, over every model
  the session used, compared as a log ratio. The claim also needs the recall difference's lower bound to stay above
  −0.1, so fewer tokens can't come from worse answers.
- **Secondary, all descriptive:**
  - total tokens on the edit tasks (percent change with a 95% interval), Catenet's overhead or savings while editing;
    added during the first registered run;
  - dependents broken, by edge label;
  - task done; precision; recall;
  - cost, turns and tool calls by tool;
  - how often context was injected;
  - hook latency.

## Statistics
- **Effect:** the mean over tasks of the per-task difference (catenet − baseline), or of the per-task log ratio for
  tokens.
- **Interval:** a percentile bootstrap with tasks fixed and runs resampled within each task and condition (10,000
  resamples, seeded).
- **Claims:** with two primary hypotheses, a claim needs its 97.5% interval to exclude zero (Bonferroni). Secondary
  results use 95% intervals and support no claims.
- **Exploratory reports:** a report is exploratory, and can't back claims, when any of these hold:
  - the driver isn't a real agent;
  - the suite changed since pre-registration (`suite.lock.json` holds its hash);
  - the trials, model, turn limit or seed differ from the lock;
  - only some tasks ran;
  - the cost cap stopped it early.

## Limits (read these before quoting a number)
- **The authors wrote the tasks.** The repository, tasks and dependents were designed by Catenet's authors, knowing
  what Catenet can see. That favours Catenet. The `none`-edge control and the leaf task are partial checks, not a
  substitute for tasks written by others.
- **These tasks only.** The interval covers run-to-run noise on these 6 scored tasks, not how Catenet would do on other
  repositories or tasks.
- **Small and synthetic.** The repository is small. In a larger, messier codebase, both searching and Catenet behave
  differently.
- **No seed control.** Claude Code has no seed or temperature setting, so runs are repeated measurements of a
  stochastic system. The block design and the bootstrap account for that, but small effects stay undetectable (see the
  minimum detectable effect in the pre-registration).
- **The agent can see `.catenet/`** in the catenet condition (the directory `catenet init` creates).
- **One agent, one model.** v0 measures Claude Code with the model in the lock. Codex comes in M8.
- **Latency comes from the hooks only.** It is measured from hook process start to the daemon's answer, at concurrency
  1. It leaves out Claude Code's own process-spawn cost.
- **No gate yet.** The gate's false-positive rate needs the M5 gate and labelled firings, so it reads "n/a until M5".
- **Cost is an estimate.** The `$` figures are Claude Code's own cost estimates. Runs on a subscription are not billed
  per call.
- **The recall guard can be gamed** by listing every file; precision is reported next to it, and every recorded answer
  so far had precision 1.0.
- **The cost cap is not in the lock.** The registered run used `--max-cost-usd 41`; the CLI default is 50.

## Commands
```
catenet eval run --plan                         # run count and estimated cost; runs nothing
catenet eval run                                # the pre-registered run (claude-code driver, parameters from the lock)
catenet eval run --driver patch                 # free, deterministic self-test of the harness (never a result)
catenet eval report <results dir>               # rebuild report.json and report.md from raw.jsonl + meta.json
catenet eval lock --trials N --model ID ...     # pre-register; commit the lock and PREREGISTRATION.md before running
catenet eval run --resume <results dir>         # continue an interrupted run (same schedule; errors are re-run)
```
Results are written to `packages/eval/results/<run-id>/`:
- `raw.jsonl`: one row per run, failures and invalid runs included;
- `meta.json`: run metadata (versions, seed, suite hash, lock);
- `report.json` and `report.md`.

Transcripts are kept only with `--keep-transcripts`, and never in this directory by default.

The `claude-code` driver uses your logged-in Claude Code, and each session counts against your plan's usage.
`--max-cost-usd` (default 50) stops the run between blocks, so both conditions stay balanced.
