import { describeSearchMetrics } from "./metrics.ts";

export function describeSearchHandler(count: number): string {
  return `search:handler:${count}`;
}

export function summarizeSearchHandler(input: string[]): string {
  const base = describeSearchMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
