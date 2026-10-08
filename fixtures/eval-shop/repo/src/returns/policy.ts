import { describeReturnsCache } from "./cache.ts";

export function describeReturnsPolicy(count: number): string {
  return `returns:policy:${count}`;
}

export function summarizeReturnsPolicy(input: string[]): string {
  const base = describeReturnsCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
