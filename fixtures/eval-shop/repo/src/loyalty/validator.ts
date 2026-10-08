import { describeLoyaltyMapper } from "./mapper.ts";

export function describeLoyaltyValidator(count: number): string {
  return `loyalty:validator:${count}`;
}

export function summarizeLoyaltyValidator(input: string[]): string {
  const base = describeLoyaltyMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
