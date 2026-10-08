import { describePromotionsFactory } from "./factory.ts";

export function describePromotionsHelpers(count: number): string {
  return `promotions:helpers:${count}`;
}

export function summarizePromotionsHelpers(input: string[]): string {
  const base = describePromotionsFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
