import { describePromotionsValidator } from "./validator.ts";

export function describePromotionsFormatter(count: number): string {
  return `promotions:formatter:${count}`;
}

export function summarizePromotionsFormatter(input: string[]): string {
  const base = describePromotionsValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
