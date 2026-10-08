import { describe, expect, it } from "vitest";
import { asPercentChange, bootstrapEffect, makeSchedule, mean } from "../src/index.js";

describe("bootstrapEffect", () => {
  it("is exact when there is no variance", () => {
    const e = bootstrapEffect([{ baseline: [0, 0, 0], catenet: [1, 1, 1] }], {
      kind: "difference",
      level: 0.95,
      seed: 1,
    });
    expect(e).toEqual({ estimate: 1, lo: 1, hi: 1, level: 0.95 });
  });

  it("averages per-task effects (stratified), not pooled runs", () => {
    const e = bootstrapEffect(
      [
        { baseline: [0, 0], catenet: [1, 1] }, // +1
        { baseline: [1, 1, 1, 1], catenet: [1, 1, 1, 1] }, // 0
      ],
      { kind: "difference", level: 0.95, seed: 1 },
    );
    expect(e?.estimate).toBe(0.5);
  });

  it("is reproducible from the seed and covers the estimate", () => {
    const groups = [{ baseline: [0, 1, 0, 1, 0, 0, 1, 0], catenet: [1, 1, 0, 1, 1, 1, 0, 1] }];
    const a = bootstrapEffect(groups, { kind: "difference", level: 0.95, seed: 7 });
    const b = bootstrapEffect(groups, { kind: "difference", level: 0.95, seed: 7 });
    expect(a).toEqual(b);
    expect(a?.lo).toBeLessThanOrEqual(a?.estimate ?? Number.NaN);
    expect(a?.hi).toBeGreaterThanOrEqual(a?.estimate ?? Number.NaN);
    expect((a?.hi ?? 0) - (a?.lo ?? 0)).toBeGreaterThan(0);
  });

  it("reports token savings as a log ratio and a percent change", () => {
    const e = bootstrapEffect([{ baseline: [100, 100], catenet: [50, 50] }], {
      kind: "log-ratio",
      level: 0.975,
      seed: 1,
    });
    expect(e?.estimate).toBeCloseTo(Math.log(0.5));
    expect(asPercentChange(e as NonNullable<typeof e>).estimate).toBeCloseTo(-50);
  });

  it("returns null when a task lacks runs in a condition", () => {
    expect(
      bootstrapEffect([{ baseline: [1], catenet: [] }], { kind: "difference", level: 0.95, seed: 1 }),
    ).toBeNull();
    expect(mean([])).toBeNaN();
  });
});

describe("makeSchedule", () => {
  it("makes one block per task and trial, each running both conditions in a random order", () => {
    const s = makeSchedule(["a", "b", "c"], 4, 42);
    expect(s).toHaveLength(12);
    for (const b of s) expect([...b.order].sort()).toEqual(["baseline", "catenet"]);
    for (const t of ["a", "b", "c"])
      expect(
        s
          .filter((b) => b.task === t)
          .map((b) => b.trial)
          .sort(),
      ).toEqual([0, 1, 2, 3]);
    expect(new Set(s.map((b) => b.order[0])).size).toBe(2); // both orders occur
  });

  it("is reproducible from the seed, and a different seed changes it", () => {
    expect(makeSchedule(["a", "b", "c"], 4, 42)).toEqual(makeSchedule(["a", "b", "c"], 4, 42));
    expect(makeSchedule(["a", "b", "c"], 4, 43)).not.toEqual(makeSchedule(["a", "b", "c"], 4, 42));
  });
});
