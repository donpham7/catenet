import { describeAnalyticsEvents } from "./events.ts";

export function describeAnalyticsMetrics(count: number): string {
  return `analytics:metrics:${count}`;
}

export function summarizeAnalyticsMetrics(input: string[]): string {
  const base = describeAnalyticsEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
