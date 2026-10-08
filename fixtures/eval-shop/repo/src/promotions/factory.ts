import { describePromotionsAdapter } from "./adapter.ts";

export function describePromotionsFactory(count: number): string {
  return `promotions:factory:${count}`;
}

export function summarizePromotionsFactory(input: string[]): string {
  const base = describePromotionsAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
