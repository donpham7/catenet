import { describeLoyaltyStore } from "./store.ts";

export function describeLoyaltyModel(count: number): string {
  return `loyalty:model:${count}`;
}

export function summarizeLoyaltyModel(input: string[]): string {
  const base = describeLoyaltyStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
