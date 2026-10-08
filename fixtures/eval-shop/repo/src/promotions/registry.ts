import { describePromotionsWorker } from "./worker.ts";

export function describePromotionsRegistry(count: number): string {
  return `promotions:registry:${count}`;
}

export function summarizePromotionsRegistry(input: string[]): string {
  const base = describePromotionsWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
