import { describeReturnsRules } from "./rules.ts";

export function describeReturnsEvents(count: number): string {
  return `returns:events:${count}`;
}

export function summarizeReturnsEvents(input: string[]): string {
  const base = describeReturnsRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
