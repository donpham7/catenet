import { describeRatesModel } from "./model.ts";

export function describeRatesMapper(count: number): string {
  return `rates:mapper:${count}`;
}

export function summarizeRatesMapper(input: string[]): string {
  const base = describeRatesModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
