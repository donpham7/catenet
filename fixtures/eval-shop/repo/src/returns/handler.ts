import { describeReturnsMetrics } from "./metrics.ts";

export function describeReturnsHandler(count: number): string {
  return `returns:handler:${count}`;
}

export function summarizeReturnsHandler(input: string[]): string {
  const base = describeReturnsMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
