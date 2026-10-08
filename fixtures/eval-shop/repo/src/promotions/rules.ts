import { describePromotionsPolicy } from "./policy.ts";

export function describePromotionsRules(count: number): string {
  return `promotions:rules:${count}`;
}

export function summarizePromotionsRules(input: string[]): string {
  const base = describePromotionsPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
