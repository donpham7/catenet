import { describeSupportCache } from "./cache.ts";

export function describeSupportPolicy(count: number): string {
  return `support:policy:${count}`;
}

export function summarizeSupportPolicy(input: string[]): string {
  const base = describeSupportCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
