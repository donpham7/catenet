import { describePromotionsService } from "./service.ts";

export function describePromotionsStore(count: number): string {
  return `promotions:store:${count}`;
}

export function summarizePromotionsStore(input: string[]): string {
  const base = describePromotionsService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
