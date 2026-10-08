// Effect sizes with bootstrap confidence intervals (ADR-0016). Tasks are fixed; runs are resampled within each task
// and condition, so the interval covers run-to-run noise on these tasks (not other tasks).
import { rng } from "./rng.js";

export interface TaskSamples {
  baseline: number[];
  catenet: number[];
}

export interface Estimate {
  /** The effect: mean over tasks of the per-task difference (catenet - baseline), or of the log ratio. */
  estimate: number;
  lo: number;
  hi: number;
  /** Confidence level of [lo, hi], e.g. 0.975. */
  level: number;
}

export type EffectKind = "difference" | "log-ratio";

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

function effect(groups: readonly TaskSamples[], kind: EffectKind): number {
  const per = groups.map((g) =>
    kind === "difference" ? mean(g.catenet) - mean(g.baseline) : Math.log(mean(g.catenet) / mean(g.baseline)),
  );
  return mean(per);
}

function resample(xs: readonly number[], random: () => number): number[] {
  return xs.map(() => xs[Math.floor(random() * xs.length)] as number);
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

/**
 * Percentile bootstrap of the effect. Returns null when any task lacks runs in either condition, or (log ratio) when a
 * condition's mean isn't positive.
 */
export function bootstrapEffect(
  groups: readonly TaskSamples[],
  opts: { kind: EffectKind; level: number; seed: number; resamples?: number },
): Estimate | null {
  const usable = groups.filter((g) => g.baseline.length > 0 && g.catenet.length > 0);
  if (usable.length === 0 || usable.length !== groups.length) return null;
  if (opts.kind === "log-ratio" && usable.some((g) => !(mean(g.baseline) > 0 && mean(g.catenet) > 0)))
    return null;
  const random = rng(opts.seed);
  const draws: number[] = [];
  for (let i = 0; i < (opts.resamples ?? 10_000); i++) {
    const value = effect(
      usable.map((g) => ({ baseline: resample(g.baseline, random), catenet: resample(g.catenet, random) })),
      opts.kind,
    );
    if (Number.isFinite(value)) draws.push(value);
  }
  draws.sort((a, b) => a - b);
  const tail = (1 - opts.level) / 2;
  return {
    estimate: effect(usable, opts.kind),
    lo: quantile(draws, tail),
    hi: quantile(draws, 1 - tail),
    level: opts.level,
  };
}

/** A log-ratio estimate as a percentage change (negative = catenet uses less). */
export const asPercentChange = (e: Estimate): Estimate => ({
  estimate: (Math.exp(e.estimate) - 1) * 100,
  lo: (Math.exp(e.lo) - 1) * 100,
  hi: (Math.exp(e.hi) - 1) * 100,
  level: e.level,
});
