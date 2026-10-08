import { describeRatesFactory } from "./factory.ts";

export function describeRatesHelpers(count: number): string {
  return `rates:helpers:${count}`;
}

export function summarizeRatesHelpers(input: string[]): string {
  const base = describeRatesFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
