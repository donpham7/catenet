import { describePromotionsRegistry } from "./registry.ts";

export function describePromotionsAdapter(count: number): string {
  return `promotions:adapter:${count}`;
}

export function summarizePromotionsAdapter(input: string[]): string {
  const base = describePromotionsRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
