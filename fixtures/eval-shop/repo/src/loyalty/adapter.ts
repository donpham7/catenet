import { describeLoyaltyRegistry } from "./registry.ts";

export function describeLoyaltyAdapter(count: number): string {
  return `loyalty:adapter:${count}`;
}

export function summarizeLoyaltyAdapter(input: string[]): string {
  const base = describeLoyaltyRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
