import { describeAuditFormatter } from "./formatter.ts";

export function describeAuditParser(count: number): string {
  return `audit:parser:${count}`;
}

export function summarizeAuditParser(input: string[]): string {
  const base = describeAuditFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
