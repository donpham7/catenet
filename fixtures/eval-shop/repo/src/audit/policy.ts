import { describeAuditCache } from "./cache.ts";

export function describeAuditPolicy(count: number): string {
  return `audit:policy:${count}`;
}

export function summarizeAuditPolicy(input: string[]): string {
  const base = describeAuditCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
