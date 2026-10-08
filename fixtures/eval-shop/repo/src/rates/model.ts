import { describeRatesStore } from "./store.ts";

export function describeRatesModel(count: number): string {
  return `rates:model:${count}`;
}

export function summarizeRatesModel(input: string[]): string {
  const base = describeRatesStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
