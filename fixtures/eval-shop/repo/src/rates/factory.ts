import { describeRatesAdapter } from "./adapter.ts";

export function describeRatesFactory(count: number): string {
  return `rates:factory:${count}`;
}

export function summarizeRatesFactory(input: string[]): string {
  const base = describeRatesAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
