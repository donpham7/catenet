import { describeAnalyticsModel } from "./model.ts";

export function describeAnalyticsMapper(count: number): string {
  return `analytics:mapper:${count}`;
}

export function summarizeAnalyticsMapper(input: string[]): string {
  const base = describeAnalyticsModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
