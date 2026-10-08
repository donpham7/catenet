import { describeAnalyticsRules } from "./rules.ts";

export function describeAnalyticsEvents(count: number): string {
  return `analytics:events:${count}`;
}

export function summarizeAnalyticsEvents(input: string[]): string {
  const base = describeAnalyticsRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
