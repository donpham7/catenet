import { describeInventoryHandler } from "./handler.ts";

export function describeInventoryWorker(count: number): string {
  return `inventory:worker:${count}`;
}

export function summarizeInventoryWorker(input: string[]): string {
  const base = describeInventoryHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
