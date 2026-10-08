import { describeAuditHandler } from "./handler.ts";

export function describeAuditWorker(count: number): string {
  return `audit:worker:${count}`;
}

export function summarizeAuditWorker(input: string[]): string {
  const base = describeAuditHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
