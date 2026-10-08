import { describeInventoryConfig } from "./config.ts";

export function describeInventoryService(count: number): string {
  return `inventory:service:${count}`;
}

export function summarizeInventoryService(input: string[]): string {
  const base = describeInventoryConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
