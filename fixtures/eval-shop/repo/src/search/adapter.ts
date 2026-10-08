import { describeSearchRegistry } from "./registry.ts";

export function describeSearchAdapter(count: number): string {
  return `search:adapter:${count}`;
}

export function summarizeSearchAdapter(input: string[]): string {
  const base = describeSearchRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
