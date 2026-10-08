# Catenet eval report 20261007-232450-claude-code

**Pre-registered run, with the deviations listed below** (suite hash, trials, model, max turns and seed match the lock).

**Deviations from the pre-registration:**
- Claude Code updated itself from 2.1.287 to 2.1.293 at 2026-10-08T04:53:05Z, 4.5 minutes after the resume; about 60% of the sessions (most after the resume) ran on 2.1.293. Sessions did not record their version then. A split before and after points the same way (M4 review).
- The pre-registration (PREREGISTRATION.md, suite.lock.json) was written before the run but not committed, so git does not prove its timing; the code under test is recorded as 0d8ca56+dirty.
- The run was interrupted after 96 of 280 sessions and resumed on the same schedule, lock and plugin bundle.
- Recorded after the run (2026-10-08) during the M4 review; the data in raw.jsonl is unchanged.

- Driver: claude-code (2.1.287 (Claude Code)), model claude-sonnet-5-5, max turns 40
- Suite: eval-shop `f9b2fe4aa2d8`, 7 tasks × 20 trials, seed 2026
- Catenet 0d8ca56c493c+dirty, Node 24.21.0, darwin-arm64, concurrency 1
- Runs: 280 (278 ok, 2 invalid, 0 infrastructure errors)
- Interrupted and resumed (same schedule, finished runs kept): 2026-10-08T04:48:30.598Z

## Primary results

Baseline and Catenet columns are pooled means over runs; the effect is the mean of per-task effects (the pre-registered estimate), so the two can differ.

| Hypothesis | Baseline | Catenet | Effect (catenet − baseline) | Supported |
|---|---|---|---|---|
| Edit tasks: passed without breaking a dependent (rate) | 0.86 | 1.00 | 0.14 [0.08, 0.20] (97.5% CI) | yes |
| Question tasks: total tokens (change) | 210018 | 131132 | -33.7 [-40.5, -25.3] (97.5% CI) % | yes |

Recall guard for the token claim (recall difference must stay above −0.1): -0.01 [-0.05, 0.02] (97.5% CI).

Token change per question task (95% CI): q-dependents -14.8 [-23.9, -4.7] (95% CI) %; q-tests-for -48.4 [-55.8, -38.6] (95% CI) %.

## Secondary (descriptive)

| Measure | Baseline | Catenet | Effect |
|---|---|---|---|
| Edit tasks: total tokens per run (change) | 138197 | 153443 | 11.5 [3.9, 19.5] (95% CI) % |
| Dependents broken per run (exact edges; tasks with one) | 0.38 | 0.00 | -0.38 [-0.53, -0.23] (95% CI) |
| Dependents broken per run (heuristic edges; tasks with one) | – | – | no data |
| Dependents broken per run (none edges; tasks with one) | 0.80 | 0.60 | -0.20 [-0.45, 0.10] (95% CI) |
| Edit task done (held-out acceptance) | 1.00 | 1.00 | 0.00 [0.00, 0.00] (95% CI) |
| Question precision | 1.00 | 1.00 | 0.00 [0.00, 0.00] (95% CI) |
| Question recall | 0.94 | 0.92 | -0.01 [-0.04, 0.02] (95% CI) |
| Cost per run (USD) | 0.10 | 0.09 | -0.00 [-0.01, -0.00] (95% CI) |
| Turns per run | 13.04 | 12.86 | -0.14 [-0.67, 0.38] (95% CI) |

- Catenet runs where context was injected: 100%
- Worst per-session hook p95: 1154 ms (hook start to daemon answer)
- Gate false-positive rate: n/a until M5

Tool calls per run:

| Tool | Baseline | Catenet |
|---|---|---|
| Bash | 2.41 | 1.90 |
| Edit | 3.76 | 4.14 |
| Glob | 0.21 | 0.04 |
| Grep | 2.03 | 2.00 |
| Read | 2.59 | 2.62 |
| ToolSearch | 0.00 | 0.13 |
| Write | 1.04 | 0.78 |
| mcp__plugin_catenet_catenet__get_dependents | 0.00 | 0.10 |
| mcp__plugin_catenet_catenet__tests_for | 0.00 | 0.15 |

## Per task

| Task | Runs (b/c) | Baseline | Catenet |
|---|---|---|---|
| boolean-to-result | 20/18 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 110613.35, costUsd 0.10 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 133227.17, costUsd 0.10 |
| leaf-control (control) | 20/20 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 55311.20, costUsd 0.04 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 56583.60, costUsd 0.04 |
| move-module | 20/20 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 157088.35, costUsd 0.10 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 155430.90, costUsd 0.10 |
| q-dependents | 20/20 | precision 1.00, recall 0.88, tokensTotal 134936.10, costUsd 0.09 | precision 1.00, recall 0.85, tokensTotal 115014.95, costUsd 0.08 |
| q-tests-for | 20/20 | precision 1.00, recall 1.00, tokensTotal 285099.80, costUsd 0.15 | precision 1.00, recall 1.00, tokensTotal 147248.30, costUsd 0.09 |
| rename-published-api | 20/20 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 112445.55, costUsd 0.10 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.00, tokensTotal 131426.85, costUsd 0.11 |
| signature-via-reexports | 20/20 | passedWithoutBreakage 0.45, taskPassed 1.00, visibleDependentsBroken 1.50, controlsBroken 0.80, tokensTotal 172640.25, costUsd 0.11 | passedWithoutBreakage 1.00, taskPassed 1.00, visibleDependentsBroken 0.00, controlsBroken 0.60, tokensTotal 191666.00, costUsd 0.13 |

Method and limits: packages/eval/README.md. Raw data: raw.jsonl in this directory.
