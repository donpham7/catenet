import { describeLoyaltyFactory } from "./factory.ts";

export function describeLoyaltyHelpers(count: number): string {
  return `loyalty:helpers:${count}`;
}

export function summarizeLoyaltyHelpers(input: string[]): string {
  const base = describeLoyaltyFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
