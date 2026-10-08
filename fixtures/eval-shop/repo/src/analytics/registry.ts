import { describeAnalyticsWorker } from "./worker.ts";

export function describeAnalyticsRegistry(count: number): string {
  return `analytics:registry:${count}`;
}

export function summarizeAnalyticsRegistry(input: string[]): string {
  const base = describeAnalyticsWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
