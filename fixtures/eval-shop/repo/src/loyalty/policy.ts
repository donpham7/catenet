import { describeLoyaltyCache } from "./cache.ts";

export function describeLoyaltyPolicy(count: number): string {
  return `loyalty:policy:${count}`;
}

export function summarizeLoyaltyPolicy(input: string[]): string {
  const base = describeLoyaltyCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
