import { describeAuditMapper } from "./mapper.ts";

export function describeAuditValidator(count: number): string {
  return `audit:validator:${count}`;
}

export function summarizeAuditValidator(input: string[]): string {
  const base = describeAuditMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
