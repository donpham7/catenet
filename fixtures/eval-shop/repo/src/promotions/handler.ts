import { describePromotionsMetrics } from "./metrics.ts";

export function describePromotionsHandler(count: number): string {
  return `promotions:handler:${count}`;
}

export function summarizePromotionsHandler(input: string[]): string {
  const base = describePromotionsMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
