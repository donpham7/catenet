import { describePlansEvents } from "./events.ts";

export function describePlansMetrics(count: number): string {
  return `plans:metrics:${count}`;
}

export function summarizePlansMetrics(input: string[]): string {
  const base = describePlansEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
