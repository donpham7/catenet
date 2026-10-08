import { describeInventoryRules } from "./rules.ts";

export function describeInventoryEvents(count: number): string {
  return `inventory:events:${count}`;
}

export function summarizeInventoryEvents(input: string[]): string {
  const base = describeInventoryRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
