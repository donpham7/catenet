import { describeLoyaltyParser } from "./parser.ts";

export function describeLoyaltyClient(count: number): string {
  return `loyalty:client:${count}`;
}

export function summarizeLoyaltyClient(input: string[]): string {
  const base = describeLoyaltyParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
