import { describePromotionsRules } from "./rules.ts";

export function describePromotionsEvents(count: number): string {
  return `promotions:events:${count}`;
}

export function summarizePromotionsEvents(input: string[]): string {
  const base = describePromotionsRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
