import { describePromotionsStore } from "./store.ts";

export function describePromotionsModel(count: number): string {
  return `promotions:model:${count}`;
}

export function summarizePromotionsModel(input: string[]): string {
  const base = describePromotionsStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
