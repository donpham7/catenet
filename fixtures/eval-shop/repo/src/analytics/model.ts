import { describeAnalyticsStore } from "./store.ts";

export function describeAnalyticsModel(count: number): string {
  return `analytics:model:${count}`;
}

export function summarizeAnalyticsModel(input: string[]): string {
  const base = describeAnalyticsStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
