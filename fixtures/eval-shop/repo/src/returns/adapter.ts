import { describeReturnsRegistry } from "./registry.ts";

export function describeReturnsAdapter(count: number): string {
  return `returns:adapter:${count}`;
}

export function summarizeReturnsAdapter(input: string[]): string {
  const base = describeReturnsRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
