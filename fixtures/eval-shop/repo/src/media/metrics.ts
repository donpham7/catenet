import { describeMediaEvents } from "./events.ts";

export function describeMediaMetrics(count: number): string {
  return `media:metrics:${count}`;
}

export function summarizeMediaMetrics(input: string[]): string {
  const base = describeMediaEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
