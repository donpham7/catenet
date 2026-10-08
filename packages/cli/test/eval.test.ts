// `catenet eval` end to end with the free patch driver (ROADMAP M4: one command, a versioned report, rebuildable from
// raw data). The catenet condition really runs `catenet init` and the daemon from the plugin bundle.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Io, main } from "../src/index.js";

const tmp = mkdtempSync(join(tmpdir(), "cnev-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// The plugin as the harness loads it: manifests from plugins/claude-code, the bundle the test setup built.
const plugin = join(tmp, "plugin");
cpSync(join(import.meta.dirname, "../../../plugins/claude-code"), plugin, {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes("dist"),
});
cpSync(
  join(import.meta.dirname, "../../../node_modules/.cache/catenet/plugin-test/dist"),
  join(plugin, "dist"),
  {
    recursive: true,
  },
);

async function run(...argv: string[]) {
  const out: string[] = [];
  const io: Io = { out: (l) => out.push(l), err: (l) => out.push(l), cwd: tmp };
  return { code: await main(argv, io), text: out.join("\n") };
}

describe("catenet eval", () => {
  it("plans without running anything", async () => {
    const r = await run("eval", "run", "--plan", "--trials", "10");
    expect(r.code).toBe(0);
    expect(r.text).toContain(
      "7 tasks × 10 trials = 70 blocks, 140 sessions; estimated cost $42.00 (cap $50)",
    );
  });

  it("runs both conditions, grades them, and writes a report that rebuilds from raw data", async () => {
    const out = join(tmp, "results");
    const r = await run(
      "eval",
      "run",
      "--driver",
      "patch",
      "--patch",
      "breaks-dependents",
      "--tasks",
      "signature-via-reexports,q-dependents",
      "--trials",
      "1",
      "--seed",
      "3",
      "--out",
      out,
      "--plugin-dir",
      plugin,
    );
    expect(r.code).toBe(0);
    expect(r.text).toContain("4 runs (4 ok, 0 invalid, 0 errors); exploratory");
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(report.report_version).toBe(1);
    expect(report.exploratory).toBe(true);
    expect(report.exploratoryReasons[0]).toContain("self-test");
    // The careless patch breaks the CommonJS consumer and the template-import control in both conditions.
    expect(report.primary.edit.baseline.mean).toBe(0);
    expect(report.primary.edit.catenet.mean).toBe(0);
    expect(report.secondary.dependentsBroken.exact.baseline.mean).toBe(1);
    expect(report.secondary.dependentsBroken.none.catenet.mean).toBe(1);
    const rows = readFileSync(join(out, "raw.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows.map((x) => x.condition).sort()).toEqual(["baseline", "baseline", "catenet", "catenet"]);
    expect(existsSync(join(out, "report.md"))).toBe(true);

    const before = readFileSync(join(out, "report.json"), "utf8");
    rmSync(join(out, "report.json"));
    expect((await run("eval", "report", out)).code).toBe(0);
    expect(readFileSync(join(out, "report.json"), "utf8")).toBe(before);
  }, 300_000);

  it("resumes an interrupted run: same schedule, finished runs kept, the rest appended", async () => {
    const { writeFileSync } = await import("node:fs");
    const out = join(tmp, "resume");
    const args = ["--driver", "patch", "--tasks", "leaf-control,q-tests-for", "--trials", "1", "--seed", "5"];
    expect((await run("eval", "run", ...args, "--out", out, "--plugin-dir", plugin)).code).toBe(0);
    const full = readFileSync(join(out, "raw.jsonl"), "utf8").trim().split("\n");
    // Simulate an interruption after the first two runs (no meta.json, no report yet).
    writeFileSync(join(out, "raw.jsonl"), `${full.slice(0, 2).join("\n")}\n`);
    rmSync(join(out, "meta.json"));
    rmSync(join(out, "report.json"));
    const r = await run("eval", "run", ...args, "--resume", out, "--plugin-dir", plugin);
    expect(r.code).toBe(0);
    expect(r.text).toContain("resuming: 2 runs already done");
    const rows = readFileSync(join(out, "raw.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const key = (x: { block: number; condition: string }) => `${x.block}|${x.condition}`;
    expect(rows.map(key).sort()).toEqual(full.map((l) => key(JSON.parse(l))).sort());
    const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"));
    expect(meta.resumedAt).toHaveLength(1);
    expect(readFileSync(join(out, "report.md"), "utf8")).toContain("Interrupted and resumed");

    // A different seed is a different schedule: refused (meta.json, written at the start, names the schedule).
    const wrong = await run(
      "eval",
      "run",
      ...args.slice(0, -1),
      "6",
      "--resume",
      out,
      "--plugin-dir",
      plugin,
    );
    expect(wrong.code).toBe(1);
    expect(wrong.text).toContain("another schedule");
  }, 300_000);

  it("stops the catenet condition's daemon even when the driver fails", async () => {
    const { createPatchDriver, runEval } = await import("@catenet/eval");
    const { execFileSync } = await import("node:child_process");
    const out = join(tmp, "harness-error");
    const failing = {
      ...createPatchDriver("correct"),
      async run(): Promise<never> {
        throw new Error("driver crashed");
      },
    };
    const { report } = await runEval({
      driver: failing,
      trials: 1,
      seed: 1,
      tasks: ["leaf-control"],
      model: null,
      maxTurns: null,
      maxCostUsd: 50,
      outDir: out,
      pluginDir: plugin,
      retries: 0,
    });
    expect(report.counts.error).toBe(2);
    const daemons = execFileSync("ps", ["-ww", "-o", "command=", "-ax"], { encoding: "utf8" })
      .split("\n")
      .filter((l) => /daemon\.mjs --root \S*catenet-eval-/.test(l));
    expect(daemons).toEqual([]);
  }, 120_000);

  it("refuses to run without a built plugin", async () => {
    const r = await run(
      "eval",
      "run",
      "--driver",
      "patch",
      "--trials",
      "1",
      "--plugin-dir",
      join(tmp, "nowhere"),
    );
    expect(r.code).toBe(1);
    expect(r.text).toContain("pnpm build:plugin");
  });
});
