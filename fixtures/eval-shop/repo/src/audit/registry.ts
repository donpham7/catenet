import { describeAuditWorker } from "./worker.ts";

export function describeAuditRegistry(count: number): string {
  return `audit:registry:${count}`;
}

export function summarizeAuditRegistry(input: string[]): string {
  const base = describeAuditWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
