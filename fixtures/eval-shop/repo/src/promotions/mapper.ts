import { describePromotionsModel } from "./model.ts";

export function describePromotionsMapper(count: number): string {
  return `promotions:mapper:${count}`;
}

export function summarizePromotionsMapper(input: string[]): string {
  const base = describePromotionsModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
