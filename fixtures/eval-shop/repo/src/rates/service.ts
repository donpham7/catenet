import { describeRatesConfig } from "./config.ts";

export function describeRatesService(count: number): string {
  return `rates:service:${count}`;
}

export function summarizeRatesService(input: string[]): string {
  const base = describeRatesConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
