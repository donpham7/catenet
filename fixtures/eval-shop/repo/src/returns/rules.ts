import { describeReturnsPolicy } from "./policy.ts";

export function describeReturnsRules(count: number): string {
  return `returns:rules:${count}`;
}

export function summarizeReturnsRules(input: string[]): string {
  const base = describeReturnsPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
