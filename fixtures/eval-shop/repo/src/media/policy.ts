import { describeMediaCache } from "./cache.ts";

export function describeMediaPolicy(count: number): string {
  return `media:policy:${count}`;
}

export function summarizeMediaPolicy(input: string[]): string {
  const base = describeMediaCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
