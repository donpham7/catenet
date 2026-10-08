import { describeLoyaltyValidator } from "./validator.ts";

export function describeLoyaltyFormatter(count: number): string {
  return `loyalty:formatter:${count}`;
}

export function summarizeLoyaltyFormatter(input: string[]): string {
  const base = describeLoyaltyValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
