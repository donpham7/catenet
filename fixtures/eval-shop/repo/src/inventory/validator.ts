import { describeInventoryMapper } from "./mapper.ts";

export function describeInventoryValidator(count: number): string {
  return `inventory:validator:${count}`;
}

export function summarizeInventoryValidator(input: string[]): string {
  const base = describeInventoryMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
