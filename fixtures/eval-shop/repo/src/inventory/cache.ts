import { describeInventoryClient } from "./client.ts";

export function describeInventoryCache(count: number): string {
  return `inventory:cache:${count}`;
}

export function summarizeInventoryCache(input: string[]): string {
  const base = describeInventoryClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
