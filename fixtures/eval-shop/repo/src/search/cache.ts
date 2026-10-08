import { describeSearchClient } from "./client.ts";

export function describeSearchCache(count: number): string {
  return `search:cache:${count}`;
}

export function summarizeSearchCache(input: string[]): string {
  const base = describeSearchClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
