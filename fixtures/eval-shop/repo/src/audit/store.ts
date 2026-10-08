import { describeAuditService } from "./service.ts";

export function describeAuditStore(count: number): string {
  return `audit:store:${count}`;
}

export function summarizeAuditStore(input: string[]): string {
  const base = describeAuditService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
