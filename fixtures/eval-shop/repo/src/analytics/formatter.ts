import { describeAnalyticsValidator } from "./validator.ts";

export function describeAnalyticsFormatter(count: number): string {
  return `analytics:formatter:${count}`;
}

export function summarizeAnalyticsFormatter(input: string[]): string {
  const base = describeAnalyticsValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
