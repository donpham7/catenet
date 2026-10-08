import { describeReturnsClient } from "./client.ts";

export function describeReturnsCache(count: number): string {
  return `returns:cache:${count}`;
}

export function summarizeReturnsCache(input: string[]): string {
  const base = describeReturnsClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
