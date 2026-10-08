import { describeRatesMetrics } from "./metrics.ts";

export function describeRatesHandler(count: number): string {
  return `rates:handler:${count}`;
}

export function summarizeRatesHandler(input: string[]): string {
  const base = describeRatesMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
