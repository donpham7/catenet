import { describeRatesPolicy } from "./policy.ts";

export function describeRatesRules(count: number): string {
  return `rates:rules:${count}`;
}

export function summarizeRatesRules(input: string[]): string {
  const base = describeRatesPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
