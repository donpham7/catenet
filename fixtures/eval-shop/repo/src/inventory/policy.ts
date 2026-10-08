import { describeInventoryCache } from "./cache.ts";

export function describeInventoryPolicy(count: number): string {
  return `inventory:policy:${count}`;
}

export function summarizeInventoryPolicy(input: string[]): string {
  const base = describeInventoryCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
