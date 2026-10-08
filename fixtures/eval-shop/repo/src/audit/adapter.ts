import { describeAuditRegistry } from "./registry.ts";

export function describeAuditAdapter(count: number): string {
  return `audit:adapter:${count}`;
}

export function summarizeAuditAdapter(input: string[]): string {
  const base = describeAuditRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
