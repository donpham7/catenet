import { describeAnalyticsFactory } from "./factory.ts";

export function describeAnalyticsHelpers(count: number): string {
  return `analytics:helpers:${count}`;
}

export function summarizeAnalyticsHelpers(input: string[]): string {
  const base = describeAnalyticsFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
