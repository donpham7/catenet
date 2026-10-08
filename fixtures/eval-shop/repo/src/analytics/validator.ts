import { describeAnalyticsMapper } from "./mapper.ts";

export function describeAnalyticsValidator(count: number): string {
  return `analytics:validator:${count}`;
}

export function summarizeAnalyticsValidator(input: string[]): string {
  const base = describeAnalyticsMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
