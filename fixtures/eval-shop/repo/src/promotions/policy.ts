import { describePromotionsCache } from "./cache.ts";

export function describePromotionsPolicy(count: number): string {
  return `promotions:policy:${count}`;
}

export function summarizePromotionsPolicy(input: string[]): string {
  const base = describePromotionsCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
