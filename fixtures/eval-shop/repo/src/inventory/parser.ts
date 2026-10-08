import { describeInventoryFormatter } from "./formatter.ts";

export function describeInventoryParser(count: number): string {
  return `inventory:parser:${count}`;
}

export function summarizeInventoryParser(input: string[]): string {
  const base = describeInventoryFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
