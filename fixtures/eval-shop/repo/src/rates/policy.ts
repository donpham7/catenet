import { describeRatesCache } from "./cache.ts";

export function describeRatesPolicy(count: number): string {
  return `rates:policy:${count}`;
}

export function summarizeRatesPolicy(input: string[]): string {
  const base = describeRatesCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
