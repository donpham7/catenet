import { describeAuditRules } from "./rules.ts";

export function describeAuditEvents(count: number): string {
  return `audit:events:${count}`;
}

export function summarizeAuditEvents(input: string[]): string {
  const base = describeAuditRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
