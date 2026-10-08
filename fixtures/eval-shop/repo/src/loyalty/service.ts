import { describeLoyaltyConfig } from "./config.ts";

export function describeLoyaltyService(count: number): string {
  return `loyalty:service:${count}`;
}

export function summarizeLoyaltyService(input: string[]): string {
  const base = describeLoyaltyConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
