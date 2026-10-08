import { describeAnalyticsRegistry } from "./registry.ts";

export function describeAnalyticsAdapter(count: number): string {
  return `analytics:adapter:${count}`;
}

export function summarizeAnalyticsAdapter(input: string[]): string {
  const base = describeAnalyticsRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
