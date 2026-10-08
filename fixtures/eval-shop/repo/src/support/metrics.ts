import { describeSupportEvents } from "./events.ts";

export function describeSupportMetrics(count: number): string {
  return `support:metrics:${count}`;
}

export function summarizeSupportMetrics(input: string[]): string {
  const base = describeSupportEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
