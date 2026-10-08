import { describeAuditAdapter } from "./adapter.ts";

export function describeAuditFactory(count: number): string {
  return `audit:factory:${count}`;
}

export function summarizeAuditFactory(input: string[]): string {
  const base = describeAuditAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
