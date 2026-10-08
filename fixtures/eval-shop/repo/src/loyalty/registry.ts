import { describeLoyaltyWorker } from "./worker.ts";

export function describeLoyaltyRegistry(count: number): string {
  return `loyalty:registry:${count}`;
}

export function summarizeLoyaltyRegistry(input: string[]): string {
  const base = describeLoyaltyWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
