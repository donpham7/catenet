import { describeAnalyticsFormatter } from "./formatter.ts";

export function describeAnalyticsParser(count: number): string {
  return `analytics:parser:${count}`;
}

export function summarizeAnalyticsParser(input: string[]): string {
  const base = describeAnalyticsFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
