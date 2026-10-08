import { describeAnalyticsAdapter } from "./adapter.ts";

export function describeAnalyticsFactory(count: number): string {
  return `analytics:factory:${count}`;
}

export function summarizeAnalyticsFactory(input: string[]): string {
  const base = describeAnalyticsAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
