import { describeAnalyticsCache } from "./cache.ts";

export function describeAnalyticsPolicy(count: number): string {
  return `analytics:policy:${count}`;
}

export function summarizeAnalyticsPolicy(input: string[]): string {
  const base = describeAnalyticsCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
