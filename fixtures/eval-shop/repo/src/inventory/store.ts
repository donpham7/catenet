import { describeInventoryService } from "./service.ts";

export function describeInventoryStore(count: number): string {
  return `inventory:store:${count}`;
}

export function summarizeInventoryStore(input: string[]): string {
  const base = describeInventoryService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
