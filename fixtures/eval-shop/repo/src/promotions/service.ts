import { describePromotionsConfig } from "./config.ts";

export function describePromotionsService(count: number): string {
  return `promotions:service:${count}`;
}

export function summarizePromotionsService(input: string[]): string {
  const base = describePromotionsConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
