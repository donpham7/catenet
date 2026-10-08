import { describeAuditConfig } from "./config.ts";

export function describeAuditService(count: number): string {
  return `audit:service:${count}`;
}

export function summarizeAuditService(input: string[]): string {
  const base = describeAuditConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
