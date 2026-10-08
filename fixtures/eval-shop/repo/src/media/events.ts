import { describeMediaRules } from "./rules.ts";

export function describeMediaEvents(count: number): string {
  return `media:events:${count}`;
}

export function summarizeMediaEvents(input: string[]): string {
  const base = describeMediaRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
