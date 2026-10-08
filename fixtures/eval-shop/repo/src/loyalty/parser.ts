import { describeLoyaltyFormatter } from "./formatter.ts";

export function describeLoyaltyParser(count: number): string {
  return `loyalty:parser:${count}`;
}

export function summarizeLoyaltyParser(input: string[]): string {
  const base = describeLoyaltyFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
