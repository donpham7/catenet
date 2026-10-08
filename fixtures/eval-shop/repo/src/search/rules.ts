import { describeSearchPolicy } from "./policy.ts";

export function describeSearchRules(count: number): string {
  return `search:rules:${count}`;
}

export function summarizeSearchRules(input: string[]): string {
  const base = describeSearchPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
