import { describeRatesClient } from "./client.ts";

export function describeRatesCache(count: number): string {
  return `rates:cache:${count}`;
}

export function summarizeRatesCache(input: string[]): string {
  const base = describeRatesClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
