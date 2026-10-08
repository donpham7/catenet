import { describeRatesEvents } from "./events.ts";

export function describeRatesMetrics(count: number): string {
  return `rates:metrics:${count}`;
}

export function summarizeRatesMetrics(input: string[]): string {
  const base = describeRatesEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
