import { describeRatesRules } from "./rules.ts";

export function describeRatesEvents(count: number): string {
  return `rates:events:${count}`;
}

export function summarizeRatesEvents(input: string[]): string {
  const base = describeRatesRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
