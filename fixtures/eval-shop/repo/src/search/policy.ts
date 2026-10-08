import { describeSearchCache } from "./cache.ts";

export function describeSearchPolicy(count: number): string {
  return `search:policy:${count}`;
}

export function summarizeSearchPolicy(input: string[]): string {
  const base = describeSearchCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
