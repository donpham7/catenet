import { describeSupportPolicy } from "./policy.ts";

export function describeSupportRules(count: number): string {
  return `support:rules:${count}`;
}

export function summarizeSupportRules(input: string[]): string {
  const base = describeSupportPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
