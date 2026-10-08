import { describePromotionsParser } from "./parser.ts";

export function describePromotionsClient(count: number): string {
  return `promotions:client:${count}`;
}

export function summarizePromotionsClient(input: string[]): string {
  const base = describePromotionsParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
