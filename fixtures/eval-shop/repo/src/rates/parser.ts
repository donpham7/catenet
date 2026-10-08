import { describeRatesFormatter } from "./formatter.ts";

export function describeRatesParser(count: number): string {
  return `rates:parser:${count}`;
}

export function summarizeRatesParser(input: string[]): string {
  const base = describeRatesFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
