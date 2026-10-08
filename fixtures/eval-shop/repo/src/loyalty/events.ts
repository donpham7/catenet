import { describeLoyaltyRules } from "./rules.ts";

export function describeLoyaltyEvents(count: number): string {
  return `loyalty:events:${count}`;
}

export function summarizeLoyaltyEvents(input: string[]): string {
  const base = describeLoyaltyRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
