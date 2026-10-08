// Results: raw.jsonl (one row per run, failures and invalid runs included), report.json (versioned) and report.md.
// The report is a pure function of the rows and the run metadata, so `catenet eval report` rebuilds it from raw data.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeDeep } from "@catenet/core";
import type { CheckResult } from "./checks.js";
import type { DriverResult } from "./drivers/types.js";
import type { Condition } from "./schedule.js";
import { asPercentChange, bootstrapEffect, type Estimate, mean, type TaskSamples } from "./stats.js";
import type { Edge } from "./suite.js";

export const REPORT_VERSION = 1;
/** Two primary hypotheses, so each needs a 97.5% interval (Bonferroni) to support a claim. */
export const PRIMARY_LEVEL = 0.975;
export const SECONDARY_LEVEL = 0.95;

export interface CatenetStats {
  /** Hook answers that added context for the agent. */
  contextInjections: number;
  syncHooks: number;
  hookP95Ms: number | null;
  hookFailures: number;
}

export interface RunRow {
  block: number;
  trial: number;
  task: string;
  kind: "edit" | "question";
  /** Edit tasks without dependents are controls, outside the primary analysis. */
  control: boolean;
  condition: Condition;
  /** ok: counts. invalid: ran, but isolation failed (excluded, reason kept). error: infrastructure failed. */
  status: "ok" | "invalid" | "error";
  attempts: number;
  /** Agent cost over every attempt, retries included (missing in rows recorded before the M4 review). */
  spentUsd?: number;
  agent: DriverResult;
  check: CheckResult | null;
  catenet: CatenetStats | null;
}

export interface RunMeta {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** When the run was resumed after an interruption (same schedule; finished runs kept). */
  resumedAt: string[];
  /** Agent versions the sessions reported (absent in runs recorded before the M4 review). */
  agentVersions?: string[];
  /** Known departures from the pre-registration, written down by people after the fact; shown at the top. */
  deviations?: string[];
  driver: string;
  agentVersion: string;
  model: string | null;
  maxTurns: number | null;
  catenetCommit: string;
  suite: { name: string; hash: string; taskIds: string[]; allTasks: boolean };
  /** The pre-registration lock, if any. */
  lock: { hash: string; trials: number; model: string; maxTurns: number; seed: number } | null;
  seed: number;
  trials: number;
  concurrency: 1;
  maxCostUsd: number;
  stoppedEarly: boolean;
  node: string;
  platform: string;
}

interface Side {
  runs: number;
  mean: number | null;
}
interface Comparison {
  baseline: Side;
  catenet: Side;
  effect: Estimate | null;
}

export interface Report {
  report_version: number;
  meta: RunMeta;
  /** Exploratory reports can't back claims (README "Reporting"). */
  exploratory: boolean;
  exploratoryReasons: string[];
  counts: {
    runs: number;
    ok: number;
    invalid: number;
    error: number;
    /** Valid runs without token data (e.g. no result event); they are left out of the token comparisons. */
    missingTokens: number;
  };
  primary: {
    /**
     * Whether each pre-registered hypothesis is supported: H1 needs its interval entirely above 0; H2 entirely below 0
     * with the recall guard passing; neither can be supported by an exploratory report.
     */
    supported: { edit: boolean; question: boolean };
    edit: Comparison & { metric: "passed_without_breakage" };
    question: Comparison & {
      metric: "tokens_total";
      /** The log ratio as a percent change in tokens (negative = fewer with Catenet). */
      percentChange: Estimate | null;
      /** Recall difference; the token claim stands only if its lower bound is above -0.1. */
      recallGuard: Estimate | null;
      guardOk: boolean | null;
    };
  };
  secondary: {
    /**
     * Total tokens on the primary edit tasks (log ratio, as a percent change): Catenet's overhead or savings while
     * editing, next to H1's success rate. Added during the registered run, before any analysis; descriptive only.
     */
    editTokens: Comparison & { percentChange: Estimate | null };
    /** Token change on each question task separately (H2 averages them). */
    questionTokensByTask: Record<string, Estimate | null>;
    /** Broken dependents per run, by edge label, over the tasks that have such a dependent only. */
    dependentsBroken: Record<Edge, Comparison | "no data">;
    taskPassed: Comparison;
    precision: Comparison;
    recall: Comparison;
    costUsd: Comparison;
    turns: Comparison;
    toolCallsPerRun: Record<Condition, Record<string, number>>;
    contextInjectedRate: number | null;
    hookP95Ms: number | null;
    gateFalsePositiveRate: "n/a until M5";
  };
  perTask: {
    task: string;
    kind: "edit" | "question";
    control: boolean;
    baseline: Record<string, number | null>;
    catenet: Record<string, number | null>;
    runs: Record<Condition, number>;
  }[];
}

const usable = (rows: readonly RunRow[]) => rows.filter((r) => r.status === "ok" && r.check);

function groupsBy(rows: readonly RunRow[], value: (r: RunRow) => number | null): Map<string, TaskSamples> {
  const groups = new Map<string, TaskSamples>();
  for (const r of rows) {
    const v = value(r);
    if (v === null || !Number.isFinite(v)) continue;
    const g = groups.get(r.task) ?? { baseline: [], catenet: [] };
    g[r.condition].push(v);
    groups.set(r.task, g);
  }
  return groups;
}

function compare(
  rows: readonly RunRow[],
  value: (r: RunRow) => number | null,
  kind: "difference" | "log-ratio",
  level: number,
  seed: number,
): Comparison {
  const groups = groupsBy(rows, value);
  const all = (c: Condition) => [...groups.values()].flatMap((g) => g[c]);
  const side = (c: Condition): Side => ({ runs: all(c).length, mean: all(c).length ? mean(all(c)) : null });
  return {
    baseline: side("baseline"),
    catenet: side("catenet"),
    effect: bootstrapEffect([...groups.values()], { kind, level, seed }),
  };
}

const edit = (r: RunRow) => (r.check?.kind === "edit" ? r.check : null);
const question = (r: RunRow) => (r.check?.kind === "question" ? r.check : null);
const bool = (b: boolean | undefined) => (b === undefined ? null : b ? 1 : 0);

export function buildReport(rows: readonly RunRow[], meta: RunMeta): Report {
  const seed = meta.seed;
  const ok = usable(rows);
  const editRows = ok.filter((r) => r.kind === "edit" && !r.control);
  const questionRows = ok.filter((r) => r.kind === "question");

  const reasons: string[] = [];
  if (meta.driver !== "claude-code")
    reasons.push(`driver ${meta.driver} is a harness self-test, not an agent`);
  if (!meta.lock) reasons.push("no pre-registration lock");
  else {
    if (meta.lock.hash !== meta.suite.hash) reasons.push("suite changed since pre-registration");
    if (meta.trials !== meta.lock.trials)
      reasons.push(`trials ${meta.trials} differ from the registered ${meta.lock.trials}`);
    if (meta.model !== meta.lock.model)
      reasons.push(`model ${meta.model} differs from the registered ${meta.lock.model}`);
    if (meta.maxTurns !== meta.lock.maxTurns) reasons.push("max turns differ from the registration");
    if (meta.seed !== meta.lock.seed) reasons.push("seed differs from the registration");
  }
  if (!meta.suite.allTasks) reasons.push("only a subset of the tasks ran");
  if ((meta.agentVersions?.length ?? 0) > 1)
    reasons.push(`the agent changed version during the run (${meta.agentVersions?.join(", ")})`);
  if (meta.stoppedEarly) reasons.push("stopped early at the cost cap");

  const tokens = compare(questionRows, (r) => r.agent.tokensTotal, "log-ratio", PRIMARY_LEVEL, seed);
  const editTokens = compare(editRows, (r) => r.agent.tokensTotal, "log-ratio", SECONDARY_LEVEL, seed);
  const recallGuard = compare(
    questionRows,
    (r) => question(r)?.recall ?? null,
    "difference",
    PRIMARY_LEVEL,
    seed,
  );

  const byEdge = {} as Record<Edge, Comparison | "no data">;
  for (const e of ["exact", "heuristic", "none"] as const) {
    const has = editRows.some((r) => edit(r)?.dependents.some((d) => d.edge === e));
    // Only tasks that have such a dependent: averaging zeros from the others would dilute it (M4 review).
    byEdge[e] = has
      ? compare(
          editRows,
          (r) => {
            const deps = edit(r)?.dependents ?? [];
            return deps.some((d) => d.edge === e)
              ? deps.filter((d) => d.edge === e && d.broken).length
              : null;
          },
          "difference",
          SECONDARY_LEVEL,
          seed,
        )
      : "no data";
  }

  const toolCallsPerRun = { baseline: {}, catenet: {} } as Record<Condition, Record<string, number>>;
  for (const c of ["baseline", "catenet"] as const) {
    const runs = ok.filter((r) => r.condition === c);
    const totals: Record<string, number> = {};
    for (const r of runs)
      for (const [t, n] of Object.entries(r.agent.toolCalls)) totals[t] = (totals[t] ?? 0) + n;
    for (const [t, n] of Object.entries(totals).sort())
      toolCallsPerRun[c][t] = runs.length ? n / runs.length : 0;
  }
  const catenetRuns = ok.filter((r) => r.condition === "catenet" && r.catenet);
  const p95s = catenetRuns.map((r) => r.catenet?.hookP95Ms).filter((v): v is number => typeof v === "number");

  const taskIds = [...new Set(rows.map((r) => r.task))].sort();
  const perTask = taskIds.map((task) => {
    const mine = ok.filter((r) => r.task === task);
    const first = rows.find((r) => r.task === task) as RunRow;
    const summary = (c: Condition): Record<string, number | null> => {
      const rs = mine.filter((r) => r.condition === c);
      const m = (f: (r: RunRow) => number | null) => {
        const xs = rs.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
        return xs.length ? mean(xs) : null;
      };
      return first.kind === "edit"
        ? {
            passedWithoutBreakage: m((r) => bool(edit(r)?.passedWithoutBreakage)),
            taskPassed: m((r) => bool(edit(r)?.acceptancePassed)),
            visibleDependentsBroken: m((r) => {
              const c = edit(r);
              return c ? c.dependentsBroken - c.controlsBroken : null;
            }),
            controlsBroken: m((r) => edit(r)?.controlsBroken ?? null),
            tokensTotal: m((r) => r.agent.tokensTotal),
            costUsd: m((r) => r.agent.costUsd),
          }
        : {
            precision: m((r) => question(r)?.precision ?? null),
            recall: m((r) => question(r)?.recall ?? null),
            tokensTotal: m((r) => r.agent.tokensTotal),
            costUsd: m((r) => r.agent.costUsd),
          };
    };
    return {
      task,
      kind: first.kind,
      control: first.control,
      baseline: summary("baseline"),
      catenet: summary("catenet"),
      runs: {
        baseline: mine.filter((r) => r.condition === "baseline").length,
        catenet: mine.filter((r) => r.condition === "catenet").length,
      },
    };
  });

  const editPrimary = compare(
    editRows,
    (r) => bool(edit(r)?.passedWithoutBreakage),
    "difference",
    PRIMARY_LEVEL,
    seed,
  );
  const guardOk = recallGuard.effect ? recallGuard.effect.lo > -0.1 : null;
  const questionTokensByTask: Record<string, Estimate | null> = {};
  for (const id of [...new Set(questionRows.map((r) => r.task))].sort()) {
    const e = compare(
      questionRows.filter((r) => r.task === id),
      (r) => r.agent.tokensTotal,
      "log-ratio",
      SECONDARY_LEVEL,
      seed,
    ).effect;
    questionTokensByTask[id] = e ? asPercentChange(e) : null;
  }
  const exploratory = reasons.length > 0;

  return {
    report_version: REPORT_VERSION,
    meta,
    exploratory,
    exploratoryReasons: reasons,
    counts: {
      runs: rows.length,
      ok: ok.length,
      invalid: rows.filter((r) => r.status === "invalid").length,
      error: rows.filter((r) => r.status === "error").length,
      missingTokens: ok.filter((r) => r.agent.tokensTotal === null).length,
    },
    primary: {
      supported: {
        edit: !exploratory && editPrimary.effect !== null && editPrimary.effect.lo > 0,
        question: !exploratory && tokens.effect !== null && tokens.effect.hi < 0 && guardOk === true,
      },
      edit: { metric: "passed_without_breakage", ...editPrimary },
      question: {
        metric: "tokens_total",
        ...tokens,
        percentChange: tokens.effect ? asPercentChange(tokens.effect) : null,
        recallGuard: recallGuard.effect,
        guardOk,
      },
    },
    secondary: {
      editTokens: {
        ...editTokens,
        percentChange: editTokens.effect ? asPercentChange(editTokens.effect) : null,
      },
      questionTokensByTask,
      dependentsBroken: byEdge,
      taskPassed: compare(
        editRows,
        (r) => bool(edit(r)?.acceptancePassed),
        "difference",
        SECONDARY_LEVEL,
        seed,
      ),
      precision: compare(
        questionRows,
        (r) => question(r)?.precision ?? null,
        "difference",
        SECONDARY_LEVEL,
        seed,
      ),
      recall: compare(questionRows, (r) => question(r)?.recall ?? null, "difference", SECONDARY_LEVEL, seed),
      costUsd: compare(ok, (r) => r.agent.costUsd, "difference", SECONDARY_LEVEL, seed),
      turns: compare(ok, (r) => r.agent.turns, "difference", SECONDARY_LEVEL, seed),
      toolCallsPerRun,
      contextInjectedRate: catenetRuns.length
        ? catenetRuns.filter((r) => (r.catenet?.contextInjections ?? 0) > 0).length / catenetRuns.length
        : null,
      hookP95Ms: p95s.length ? Math.max(...p95s) : null,
      gateFalsePositiveRate: "n/a until M5",
    },
    perTask,
  };
}

const f = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "–" : n.toFixed(digits);
const ci = (e: Estimate | null, digits = 2) =>
  e
    ? `${f(e.estimate, digits)} [${f(e.lo, digits)}, ${f(e.hi, digits)}] (${Math.round(e.level * 1000) / 10}% CI)`
    : "no data";

export function renderMarkdown(r: Report): string {
  const m = r.meta;
  const lines = [
    `# Catenet eval report ${m.runId}`,
    "",
    r.exploratory
      ? `**Exploratory: cannot back claims.** ${r.exploratoryReasons.join("; ")}.`
      : m.deviations?.length
        ? "**Pre-registered run, with the deviations listed below** (suite hash, trials, model, max turns and seed match the lock)."
        : "**Pre-registered run** (suite hash, trials, model, max turns and seed match the lock).",
    ...(m.deviations?.length
      ? ["", "**Deviations from the pre-registration:**", ...m.deviations.map((d) => `- ${d}`)]
      : []),
    "",
    `- Driver: ${m.driver} (${m.agentVersion}), model ${m.model ?? "–"}, max turns ${m.maxTurns ?? "–"}`,
    `- Suite: ${m.suite.name} \`${m.suite.hash.slice(0, 12)}\`, ${m.suite.taskIds.length} tasks × ${m.trials} trials, seed ${m.seed}`,
    `- Catenet ${m.catenetCommit}, Node ${m.node}, ${m.platform}, concurrency ${m.concurrency}`,
    `- Runs: ${r.counts.runs} (${r.counts.ok} ok, ${r.counts.invalid} invalid, ${r.counts.error} infrastructure errors)${m.stoppedEarly ? "; stopped early at the cost cap" : ""}`,
    ...(m.resumedAt?.length
      ? [`- Interrupted and resumed (same schedule, finished runs kept): ${m.resumedAt.join(", ")}`]
      : []),
    "",
    "## Primary results",
    "",
    "Baseline and Catenet columns are pooled means over runs; the effect is the mean of per-task effects (the pre-registered estimate), so the two can differ.",
    "",
    "| Hypothesis | Baseline | Catenet | Effect (catenet − baseline) | Supported |",
    "|---|---|---|---|---|",
    `| Edit tasks: passed without breaking a dependent (rate) | ${f(r.primary.edit.baseline.mean)} | ${f(r.primary.edit.catenet.mean)} | ${ci(r.primary.edit.effect)} | ${r.primary.supported.edit ? "yes" : "no"} |`,
    `| Question tasks: total tokens (change) | ${f(r.primary.question.baseline.mean, 0)} | ${f(r.primary.question.catenet.mean, 0)} | ${ci(r.primary.question.percentChange, 1)} % | ${r.primary.supported.question ? "yes" : "no"} |`,
    "",
    `Recall guard for the token claim (recall difference must stay above −0.1): ${ci(r.primary.question.recallGuard)}.`,
    "",
    `Token change per question task (95% CI): ${
      Object.entries(r.secondary.questionTokensByTask)
        .map(([t, e]) => `${t} ${ci(e, 1)} %`)
        .join("; ") || "–"
    }.${r.counts.missingTokens ? ` ${r.counts.missingTokens} valid run(s) had no token data and are left out of token comparisons.` : ""}`,
    "",
    "## Secondary (descriptive)",
    "",
    "| Measure | Baseline | Catenet | Effect |",
    "|---|---|---|---|",
  ];
  const row = (name: string, c: Comparison) =>
    lines.push(`| ${name} | ${f(c.baseline.mean)} | ${f(c.catenet.mean)} | ${ci(c.effect)} |`);
  lines.push(
    `| Edit tasks: total tokens per run (change) | ${f(r.secondary.editTokens.baseline.mean, 0)} | ${f(r.secondary.editTokens.catenet.mean, 0)} | ${ci(r.secondary.editTokens.percentChange, 1)} % |`,
  );
  for (const [edge, c] of Object.entries(r.secondary.dependentsBroken)) {
    const name = `Dependents broken per run (${edge} edges; tasks with one)`;
    if (c === "no data") lines.push(`| ${name} | – | – | no data |`);
    else row(name, c);
  }
  row("Edit task done (held-out acceptance)", r.secondary.taskPassed);
  row("Question precision", r.secondary.precision);
  row("Question recall", r.secondary.recall);
  row("Cost per run (USD)", r.secondary.costUsd);
  row("Turns per run", r.secondary.turns);
  lines.push(
    "",
    `- Catenet runs where context was injected: ${r.secondary.contextInjectedRate === null ? "–" : `${f(r.secondary.contextInjectedRate * 100, 0)}%`}`,
    `- Worst per-session hook p95: ${f(r.secondary.hookP95Ms, 0)} ms (hook start to daemon answer)`,
    `- Gate false-positive rate: ${r.secondary.gateFalsePositiveRate}`,
    "",
    "Tool calls per run:",
    "",
    "| Tool | Baseline | Catenet |",
    "|---|---|---|",
  );
  const tools = [
    ...new Set([
      ...Object.keys(r.secondary.toolCallsPerRun.baseline),
      ...Object.keys(r.secondary.toolCallsPerRun.catenet),
    ]),
  ].sort();
  for (const t of tools)
    lines.push(
      `| ${t} | ${f(r.secondary.toolCallsPerRun.baseline[t] ?? 0)} | ${f(r.secondary.toolCallsPerRun.catenet[t] ?? 0)} |`,
    );
  lines.push("", "## Per task", "", "| Task | Runs (b/c) | Baseline | Catenet |", "|---|---|---|---|");
  for (const t of r.perTask) {
    const show = (s: Record<string, number | null>) =>
      Object.entries(s)
        .map(([k, v]) => `${k} ${f(v)}`)
        .join(", ");
    lines.push(
      `| ${t.task}${t.control ? " (control)" : ""} | ${t.runs.baseline}/${t.runs.catenet} | ${show(t.baseline)} | ${show(t.catenet)} |`,
    );
  }
  lines.push("", "Method and limits: packages/eval/README.md. Raw data: raw.jsonl in this directory.", "");
  return lines.join("\n");
}

export function readRows(dir: string): RunRow[] {
  return readFileSync(join(dir, "raw.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRow);
}

export function writeReport(dir: string, report: Report): void {
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(sanitizeDeep(report, 2000), null, 2)}\n`);
  writeFileSync(join(dir, "report.md"), renderMarkdown(report));
}
