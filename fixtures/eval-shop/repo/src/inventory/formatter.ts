import { describeInventoryValidator } from "./validator.ts";

export function describeInventoryFormatter(count: number): string {
  return `inventory:formatter:${count}`;
}

export function summarizeInventoryFormatter(input: string[]): string {
  const base = describeInventoryValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
