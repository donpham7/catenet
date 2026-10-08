import { describeAnalyticsPolicy } from "./policy.ts";

export function describeAnalyticsRules(count: number): string {
  return `analytics:rules:${count}`;
}

export function summarizeAnalyticsRules(input: string[]): string {
  const base = describeAnalyticsPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
