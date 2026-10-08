import { describeInventoryModel } from "./model.ts";

export function describeInventoryMapper(count: number): string {
  return `inventory:mapper:${count}`;
}

export function summarizeInventoryMapper(input: string[]): string {
  const base = describeInventoryModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
