import { describePromotionsMapper } from "./mapper.ts";

export function describePromotionsValidator(count: number): string {
  return `promotions:validator:${count}`;
}

export function summarizePromotionsValidator(input: string[]): string {
  const base = describePromotionsMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
