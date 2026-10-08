import { describeInventoryParser } from "./parser.ts";

export function describeInventoryClient(count: number): string {
  return `inventory:client:${count}`;
}

export function summarizeInventoryClient(input: string[]): string {
  const base = describeInventoryParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
