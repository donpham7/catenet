import { describeAnalyticsConfig } from "./config.ts";

export function describeAnalyticsService(count: number): string {
  return `analytics:service:${count}`;
}

export function summarizeAnalyticsService(input: string[]): string {
  const base = describeAnalyticsConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
