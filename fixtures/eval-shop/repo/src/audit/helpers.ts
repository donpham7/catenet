import { describeAuditFactory } from "./factory.ts";

export function describeAuditHelpers(count: number): string {
  return `audit:helpers:${count}`;
}

export function summarizeAuditHelpers(input: string[]): string {
  const base = describeAuditFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
