// The run loop pauses while the agent's API is unreachable instead of recording failures (an owner went offline
// mid-run; without this, every remaining session would have become an infrastructure error).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPatchDriver, type Driver, runEval } from "../src/index.js";

describe("runEval", () => {
  it("waits for the network to come back before starting a session", async () => {
    const out = mkdtempSync(join(tmpdir(), "cnrun-"));
    try {
      let checks = 0;
      const log: string[] = [];
      const { report } = await runEval({
        driver: createPatchDriver("correct"),
        trials: 1,
        seed: 1,
        tasks: ["q-tests-for"],
        model: null,
        maxTurns: null,
        maxCostUsd: 50,
        outDir: out,
        online: async () => ++checks > 3, // offline for the first three checks
        offlinePollMs: 5,
        log: (l) => log.push(l),
      });
      expect(log.join("\n")).toContain("offline: waiting for the network");
      expect(log.join("\n")).toContain("back online");
      // The patch driver reports no tokens, so both runs count as missing token data.
      expect(report.counts).toEqual({ runs: 2, ok: 2, invalid: 0, error: 0, missingTokens: 2 });
      expect(readFileSync(join(out, "raw.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("gives up after the maximum offline time, so a resume can pick up later", async () => {
    const out = mkdtempSync(join(tmpdir(), "cnrun-"));
    try {
      await expect(
        runEval({
          driver: createPatchDriver("correct"),
          trials: 1,
          seed: 1,
          tasks: ["q-tests-for"],
          model: null,
          maxTurns: null,
          maxCostUsd: 50,
          outDir: out,
          online: async () => false,
          offlinePollMs: 5,
          maxOfflineMs: 20,
        }),
      ).rejects.toThrow("--resume");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses to write over a results directory that already holds runs", async () => {
    const out = mkdtempSync(join(tmpdir(), "cnrun-"));
    try {
      const opts = {
        driver: createPatchDriver("correct"),
        trials: 1,
        seed: 1,
        tasks: ["q-tests-for"],
        model: null,
        maxTurns: null,
        maxCostUsd: 50,
        outDir: out,
      };
      await runEval(opts);
      await expect(runEval(opts)).rejects.toThrow("--resume");
      expect(readFileSync(join(out, "raw.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);

  it("counts every attempt's cost, and a resume runs infrastructure errors again", async () => {
    const out = mkdtempSync(join(tmpdir(), "cnrun-"));
    try {
      const patch = createPatchDriver("correct");
      let calls = 0;
      // Fails twice (with cost), succeeds once, then always fails: the first run spends three attempts and passes,
      // the second exhausts its attempts and becomes an error row.
      const flaky: Driver = {
        name: "patch",
        version: patch.version,
        async run(ctx) {
          calls++;
          const r = await patch.run(ctx);
          return calls === 3
            ? { ...r, costUsd: 0.1 }
            : { ...r, status: "error", error: "boom", costUsd: 0.2 };
        },
      };
      const base = {
        trials: 1,
        seed: 1,
        tasks: ["q-tests-for"],
        model: null,
        maxTurns: null,
        maxCostUsd: 50,
        outDir: out,
      };
      const { report } = await runEval({ ...base, driver: flaky });
      const rows = readFileSync(join(out, "raw.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(rows[0].attempts).toBe(3);
      expect(rows[0].spentUsd).toBeCloseTo(0.5);
      expect(report.counts.ok).toBe(1); // the second run's three attempts all failed
      expect(report.counts.error).toBe(1);

      // Resuming runs the error row again instead of keeping it.
      const resumed = await runEval({ ...base, driver: patch, resume: true });
      expect(resumed.report.counts).toMatchObject({ runs: 2, ok: 2, error: 0 });
      // ...but not with another driver or model.
      await expect(runEval({ ...base, model: "other", driver: patch, resume: true })).rejects.toThrow(
        "model changed",
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
