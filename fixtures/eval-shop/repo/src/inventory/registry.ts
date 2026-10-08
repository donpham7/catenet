import { describeInventoryWorker } from "./worker.ts";

export function describeInventoryRegistry(count: number): string {
  return `inventory:registry:${count}`;
}

export function summarizeInventoryRegistry(input: string[]): string {
  const base = describeInventoryWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
