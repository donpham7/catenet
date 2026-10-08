import { describeRatesMapper } from "./mapper.ts";

export function describeRatesValidator(count: number): string {
  return `rates:validator:${count}`;
}

export function summarizeRatesValidator(input: string[]): string {
  const base = describeRatesMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
