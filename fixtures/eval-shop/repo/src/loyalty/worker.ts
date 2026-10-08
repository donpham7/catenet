import { describeLoyaltyHandler } from "./handler.ts";

export function describeLoyaltyWorker(count: number): string {
  return `loyalty:worker:${count}`;
}

export function summarizeLoyaltyWorker(input: string[]): string {
  const base = describeLoyaltyHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
