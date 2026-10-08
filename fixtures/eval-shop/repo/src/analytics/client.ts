import { describeAnalyticsParser } from "./parser.ts";

export function describeAnalyticsClient(count: number): string {
  return `analytics:client:${count}`;
}

export function summarizeAnalyticsClient(input: string[]): string {
  const base = describeAnalyticsParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
