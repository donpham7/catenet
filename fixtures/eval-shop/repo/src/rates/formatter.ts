import { describeRatesValidator } from "./validator.ts";

export function describeRatesFormatter(count: number): string {
  return `rates:formatter:${count}`;
}

export function summarizeRatesFormatter(input: string[]): string {
  const base = describeRatesValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
