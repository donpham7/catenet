import { describeInventoryStore } from "./store.ts";

export function describeInventoryModel(count: number): string {
  return `inventory:model:${count}`;
}

export function summarizeInventoryModel(input: string[]): string {
  const base = describeInventoryStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
