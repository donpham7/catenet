import { describeLoyaltyAdapter } from "./adapter.ts";

export function describeLoyaltyFactory(count: number): string {
  return `loyalty:factory:${count}`;
}

export function summarizeLoyaltyFactory(input: string[]): string {
  const base = describeLoyaltyAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
