import { describeInventoryRegistry } from "./registry.ts";

export function describeInventoryAdapter(count: number): string {
  return `inventory:adapter:${count}`;
}

export function summarizeInventoryAdapter(input: string[]): string {
  const base = describeInventoryRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
