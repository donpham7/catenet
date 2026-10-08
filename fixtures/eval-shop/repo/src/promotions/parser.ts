import { describePromotionsFormatter } from "./formatter.ts";

export function describePromotionsParser(count: number): string {
  return `promotions:parser:${count}`;
}

export function summarizePromotionsParser(input: string[]): string {
  const base = describePromotionsFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
