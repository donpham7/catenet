// The report is a pure function of raw rows and run metadata: identical input gives an identical report, and every
// reason a run can't back claims is listed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, type RunMeta, type RunRow, readRows, renderMarkdown } from "../src/index.js";

const meta: RunMeta = {
  runId: "test",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T01:00:00.000Z",
  resumedAt: [],
  driver: "claude-code",
  agentVersion: "2.1.287 (Claude Code)",
  model: "claude-sonnet-5-5",
  maxTurns: 40,
  catenetCommit: "abc",
  suite: { name: "eval-shop", hash: "h1", taskIds: ["edit-a", "q-a"], allTasks: true },
  lock: { hash: "h1", trials: 2, model: "claude-sonnet-5-5", maxTurns: 40, seed: 1 },
  seed: 1,
  trials: 2,
  concurrency: 1,
  maxCostUsd: 50,
  stoppedEarly: false,
  node: "24.0.0",
  platform: "test",
};

const agent = (tokens: number, cost: number) => ({
  status: "ok" as const,
  endReason: "success",
  durationMs: 1000,
  usage: null,
  tokensTotal: tokens,
  costUsd: cost,
  turns: 5,
  toolCalls: { Read: 2, Edit: 1 },
  model: "claude-sonnet-5-5",
  invalidReasons: [],
});

function editRow(
  condition: "baseline" | "catenet",
  trial: number,
  passed: boolean,
  brokenNone: boolean,
): RunRow {
  return {
    block: trial,
    trial,
    task: "edit-a",
    kind: "edit",
    control: false,
    condition,
    status: "ok",
    attempts: 1,
    agent: agent(10_000, 0.2),
    check: {
      kind: "edit",
      typecheckOk: true,
      typeErrorFiles: [],
      visibleTestsOk: true,
      acceptancePassed: true,
      dependents: [
        { file: "a.cjs", edge: "exact", broken: !passed, why: passed ? [] : ["test"] },
        { file: "b.ts", edge: "none", broken: brokenNone, why: brokenNone ? ["test"] : [] },
      ],
      dependentsBroken: (passed ? 0 : 1) + (brokenNone ? 1 : 0),
      controlsBroken: brokenNone ? 1 : 0,
      passedWithoutBreakage: passed,
    },
    catenet:
      condition === "catenet" ? { contextInjections: 2, syncHooks: 4, hookP95Ms: 60, hookFailures: 0 } : null,
  };
}

function questionRow(
  condition: "baseline" | "catenet",
  trial: number,
  tokens: number,
  recall: number,
): RunRow {
  return {
    block: 10 + trial,
    trial,
    task: "q-a",
    kind: "question",
    control: false,
    condition,
    status: "ok",
    attempts: 1,
    agent: agent(tokens, 0.1),
    check: { kind: "question", answered: true, files: [], precision: 1, recall },
    catenet: null,
  };
}

const rows: RunRow[] = [
  editRow("baseline", 0, false, false),
  editRow("catenet", 0, true, false),
  editRow("baseline", 1, false, true),
  editRow("catenet", 1, true, true),
  questionRow("baseline", 0, 20_000, 1),
  questionRow("catenet", 0, 10_000, 1),
  questionRow("baseline", 1, 22_000, 1),
  questionRow("catenet", 1, 11_000, 1),
  { ...editRow("catenet", 2, true, false), status: "invalid" }, // excluded from analysis, still counted
];

describe("buildReport", () => {
  it("computes the primary effects from valid rows only", () => {
    const r = buildReport(rows, meta);
    expect(r.exploratory).toBe(false);
    expect(r.counts).toEqual({ runs: 9, ok: 8, invalid: 1, error: 0, missingTokens: 0 });
    expect(r.primary.edit.baseline.mean).toBe(0);
    // The second catenet run broke only the control (a "none" edge), which the primary metric excludes.
    expect(r.primary.edit.catenet.mean).toBe(1);
    expect(r.primary.edit.effect?.estimate).toBe(1);
    expect(r.primary.edit.effect?.level).toBe(0.975);
    expect(r.primary.question.percentChange?.estimate).toBeCloseTo(-50, 0);
    expect(r.primary.question.guardOk).toBe(true);
    expect(r.secondary.dependentsBroken.heuristic).toBe("no data");
    // Edit-task tokens: 10,000 in both conditions here, so no change.
    expect(r.secondary.editTokens.percentChange?.estimate).toBeCloseTo(0);
    expect(renderMarkdown(r)).toContain("| Edit tasks: total tokens per run (change) | 10000 | 10000 |");
    expect(r.secondary.contextInjectedRate).toBe(1);
    expect(r.secondary.gateFalsePositiveRate).toBe("n/a until M5");
  });

  it("is deterministic and survives a round trip through raw.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "cnev-"));
    try {
      writeFileSync(join(dir, "raw.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
      expect(buildReport(readRows(dir), meta)).toEqual(buildReport(rows, meta));
      expect(renderMarkdown(buildReport(rows, meta))).toBe(renderMarkdown(buildReport(rows, meta)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks a run exploratory, with reasons, when it doesn't match the pre-registration", () => {
    const r = buildReport(rows, {
      ...meta,
      driver: "patch",
      suite: { ...meta.suite, hash: "h2", allTasks: false },
      trials: 3,
      stoppedEarly: true,
    });
    expect(r.exploratory).toBe(true);
    expect(r.exploratoryReasons.join("; ")).toMatch(/self-test.*suite changed.*trials 3.*subset.*cost cap/);
    expect(renderMarkdown(r)).toContain("**Exploratory: cannot back claims.**");
    expect(buildReport(rows, { ...meta, lock: null }).exploratoryReasons).toContain(
      "no pre-registration lock",
    );
  });

  it("supports a hypothesis only in the registered direction", () => {
    expect(buildReport(rows, meta).primary.supported).toEqual({ edit: true, question: true });
    // Swap the conditions: the effects reverse and must not count as support (M4 review).
    const swapped = rows.map((r) => ({
      ...r,
      condition: r.condition === "baseline" ? ("catenet" as const) : ("baseline" as const),
    }));
    const r = buildReport(swapped, meta);
    expect(r.primary.edit.effect?.estimate).toBeLessThan(0);
    expect(r.primary.supported).toEqual({ edit: false, question: false });
    expect(renderMarkdown(r)).not.toMatch(/\| yes \|/);
  });

  it("marks a run whose agent changed version as exploratory, and counts runs without token data", () => {
    const r = buildReport(
      [...rows, { ...questionRow("catenet", 2, 1, 1), agent: { ...agent(1, 0.1), tokensTotal: null } }],
      { ...meta, agentVersions: ["2.1.287", "2.1.293"] },
    );
    expect(r.exploratoryReasons).toContain("the agent changed version during the run (2.1.287, 2.1.293)");
    expect(r.counts.missingTokens).toBe(1);
    expect(Object.keys(r.secondary.questionTokensByTask)).toEqual(["q-a"]);
  });

  it("shows recorded deviations at the top", () => {
    const md = renderMarkdown(
      buildReport(rows, { ...meta, deviations: ["the agent updated itself mid-run"] }),
    );
    expect(md).toContain("**Pre-registered run, with the deviations listed below**");
    expect(md).toContain("- the agent updated itself mid-run");
  });

  it("renders the primary table with 97.5% intervals", () => {
    const md = renderMarkdown(buildReport(rows, meta));
    expect(md).toContain("## Primary results");
    expect(md).toContain("(97.5% CI)");
    expect(md).toContain("| edit-a | 2/2 |");
  });
});
