import { describePromotionsClient } from "./client.ts";

export function describePromotionsCache(count: number): string {
  return `promotions:cache:${count}`;
}

export function summarizePromotionsCache(input: string[]): string {
  const base = describePromotionsClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
