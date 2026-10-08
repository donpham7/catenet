import { describeAuditPolicy } from "./policy.ts";

export function describeAuditRules(count: number): string {
  return `audit:rules:${count}`;
}

export function summarizeAuditRules(input: string[]): string {
  const base = describeAuditPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
