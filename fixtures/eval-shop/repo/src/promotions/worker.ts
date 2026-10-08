import { describePromotionsHandler } from "./handler.ts";

export function describePromotionsWorker(count: number): string {
  return `promotions:worker:${count}`;
}

export function summarizePromotionsWorker(input: string[]): string {
  const base = describePromotionsHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
