import { describeMediaPolicy } from "./policy.ts";

export function describeMediaRules(count: number): string {
  return `media:rules:${count}`;
}

export function summarizeMediaRules(input: string[]): string {
  const base = describeMediaPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
