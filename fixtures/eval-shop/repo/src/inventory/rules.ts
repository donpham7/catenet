import { describeInventoryPolicy } from "./policy.ts";

export function describeInventoryRules(count: number): string {
  return `inventory:rules:${count}`;
}

export function summarizeInventoryRules(input: string[]): string {
  const base = describeInventoryPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
