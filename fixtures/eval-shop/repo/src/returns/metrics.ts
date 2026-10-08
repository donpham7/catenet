import { describeReturnsEvents } from "./events.ts";

export function describeReturnsMetrics(count: number): string {
  return `returns:metrics:${count}`;
}

export function summarizeReturnsMetrics(input: string[]): string {
  const base = describeReturnsEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
