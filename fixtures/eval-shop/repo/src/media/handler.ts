import { describeMediaMetrics } from "./metrics.ts";

export function describeMediaHandler(count: number): string {
  return `media:handler:${count}`;
}

export function summarizeMediaHandler(input: string[]): string {
  const base = describeMediaMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
