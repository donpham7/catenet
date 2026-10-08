import { describeLoyaltyClient } from "./client.ts";

export function describeLoyaltyCache(count: number): string {
  return `loyalty:cache:${count}`;
}

export function summarizeLoyaltyCache(input: string[]): string {
  const base = describeLoyaltyClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
