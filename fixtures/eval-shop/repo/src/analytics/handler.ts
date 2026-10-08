import { describeAnalyticsMetrics } from "./metrics.ts";

export function describeAnalyticsHandler(count: number): string {
  return `analytics:handler:${count}`;
}

export function summarizeAnalyticsHandler(input: string[]): string {
  const base = describeAnalyticsMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
