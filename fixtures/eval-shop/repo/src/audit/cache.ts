import { describeAuditClient } from "./client.ts";

export function describeAuditCache(count: number): string {
  return `audit:cache:${count}`;
}

export function summarizeAuditCache(input: string[]): string {
  const base = describeAuditClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
