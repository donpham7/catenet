import { describeAuditParser } from "./parser.ts";

export function describeAuditClient(count: number): string {
  return `audit:client:${count}`;
}

export function summarizeAuditClient(input: string[]): string {
  const base = describeAuditParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
