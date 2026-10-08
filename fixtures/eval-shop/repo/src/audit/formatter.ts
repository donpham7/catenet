import { describeAuditValidator } from "./validator.ts";

export function describeAuditFormatter(count: number): string {
  return `audit:formatter:${count}`;
}

export function summarizeAuditFormatter(input: string[]): string {
  const base = describeAuditValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
