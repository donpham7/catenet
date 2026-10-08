import { describeInventoryEvents } from "./events.ts";

export function describeInventoryMetrics(count: number): string {
  return `inventory:metrics:${count}`;
}

export function summarizeInventoryMetrics(input: string[]): string {
  const base = describeInventoryEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
