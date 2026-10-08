import { describeLoyaltyService } from "./service.ts";

export function describeLoyaltyStore(count: number): string {
  return `loyalty:store:${count}`;
}

export function summarizeLoyaltyStore(input: string[]): string {
  const base = describeLoyaltyService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
