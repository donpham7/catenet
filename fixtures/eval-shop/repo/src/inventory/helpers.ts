import { describeInventoryFactory } from "./factory.ts";

export function describeInventoryHelpers(count: number): string {
  return `inventory:helpers:${count}`;
}

export function summarizeInventoryHelpers(input: string[]): string {
  const base = describeInventoryFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
