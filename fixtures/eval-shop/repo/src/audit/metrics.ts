import { describeAuditEvents } from "./events.ts";

export function describeAuditMetrics(count: number): string {
  return `audit:metrics:${count}`;
}

export function summarizeAuditMetrics(input: string[]): string {
  const base = describeAuditEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
