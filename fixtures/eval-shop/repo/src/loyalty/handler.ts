import { describeLoyaltyMetrics } from "./metrics.ts";

export function describeLoyaltyHandler(count: number): string {
  return `loyalty:handler:${count}`;
}

export function summarizeLoyaltyHandler(input: string[]): string {
  const base = describeLoyaltyMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
