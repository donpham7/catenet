import { describeRatesParser } from "./parser.ts";

export function describeRatesClient(count: number): string {
  return `rates:client:${count}`;
}

export function summarizeRatesClient(input: string[]): string {
  const base = describeRatesParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
