import { describeInventoryMetrics } from "./metrics.ts";

export function describeInventoryHandler(count: number): string {
  return `inventory:handler:${count}`;
}

export function summarizeInventoryHandler(input: string[]): string {
  const base = describeInventoryMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
