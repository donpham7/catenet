import { describeSearchRules } from "./rules.ts";

export function describeSearchEvents(count: number): string {
  return `search:events:${count}`;
}

export function summarizeSearchEvents(input: string[]): string {
  const base = describeSearchRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
