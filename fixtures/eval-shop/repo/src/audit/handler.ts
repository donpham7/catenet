import { describeAuditMetrics } from "./metrics.ts";

export function describeAuditHandler(count: number): string {
  return `audit:handler:${count}`;
}

export function summarizeAuditHandler(input: string[]): string {
  const base = describeAuditMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
