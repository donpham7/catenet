import { describeAnalyticsClient } from "./client.ts";

export function describeAnalyticsCache(count: number): string {
  return `analytics:cache:${count}`;
}

export function summarizeAnalyticsCache(input: string[]): string {
  const base = describeAnalyticsClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
