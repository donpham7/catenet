import { describeAuditModel } from "./model.ts";

export function describeAuditMapper(count: number): string {
  return `audit:mapper:${count}`;
}

export function summarizeAuditMapper(input: string[]): string {
  const base = describeAuditModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
