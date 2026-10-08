import { describeLoyaltyPolicy } from "./policy.ts";

export function describeLoyaltyRules(count: number): string {
  return `loyalty:rules:${count}`;
}

export function summarizeLoyaltyRules(input: string[]): string {
  const base = describeLoyaltyPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
