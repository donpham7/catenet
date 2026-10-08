import { describeRatesRegistry } from "./registry.ts";

export function describeRatesAdapter(count: number): string {
  return `rates:adapter:${count}`;
}

export function summarizeRatesAdapter(input: string[]): string {
  const base = describeRatesRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
