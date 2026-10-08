import { describeSearchEvents } from "./events.ts";

export function describeSearchMetrics(count: number): string {
  return `search:metrics:${count}`;
}

export function summarizeSearchMetrics(input: string[]): string {
  const base = describeSearchEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
