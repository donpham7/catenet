import { describeLoyaltyModel } from "./model.ts";

export function describeLoyaltyMapper(count: number): string {
  return `loyalty:mapper:${count}`;
}

export function summarizeLoyaltyMapper(input: string[]): string {
  const base = describeLoyaltyModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
