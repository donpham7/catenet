import { describeInventoryAdapter } from "./adapter.ts";

export function describeInventoryFactory(count: number): string {
  return `inventory:factory:${count}`;
}

export function summarizeInventoryFactory(input: string[]): string {
  const base = describeInventoryAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
