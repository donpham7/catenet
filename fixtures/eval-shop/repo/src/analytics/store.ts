import { describeAnalyticsService } from "./service.ts";

export function describeAnalyticsStore(count: number): string {
  return `analytics:store:${count}`;
}

export function summarizeAnalyticsStore(input: string[]): string {
  const base = describeAnalyticsService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
