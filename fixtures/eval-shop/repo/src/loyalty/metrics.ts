import { describeLoyaltyEvents } from "./events.ts";

export function describeLoyaltyMetrics(count: number): string {
  return `loyalty:metrics:${count}`;
}

export function summarizeLoyaltyMetrics(input: string[]): string {
  const base = describeLoyaltyEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
