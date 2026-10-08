import { describeAnalyticsHandler } from "./handler.ts";

export function describeAnalyticsWorker(count: number): string {
  return `analytics:worker:${count}`;
}

export function summarizeAnalyticsWorker(input: string[]): string {
  const base = describeAnalyticsHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
