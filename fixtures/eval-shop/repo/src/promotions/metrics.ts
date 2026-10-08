import { describePromotionsEvents } from "./events.ts";

export function describePromotionsMetrics(count: number): string {
  return `promotions:metrics:${count}`;
}

export function summarizePromotionsMetrics(input: string[]): string {
  const base = describePromotionsEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
