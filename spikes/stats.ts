// Shared timing helpers for the M0 spikes.
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? Number.NaN;
}

export interface Summary {
  label: string;
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function summarize(label: string, samplesMs: number[]): Summary {
  const s = [...samplesMs].sort((a, b) => a - b);
  return {
    label,
    n: s.length,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1] ?? Number.NaN,
  };
}

export function printTable(rows: Summary[]): void {
  console.log("| case | n | p50 ms | p95 ms | max ms |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.label} | ${r.n} | ${r.p50.toFixed(3)} | ${r.p95.toFixed(3)} | ${r.max.toFixed(3)} |`);
  }
}

export function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}
