export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
