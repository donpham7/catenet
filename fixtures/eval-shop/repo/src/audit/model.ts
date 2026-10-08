import { describeAuditStore } from "./store.ts";

export function describeAuditModel(count: number): string {
  return `audit:model:${count}`;
}

export function summarizeAuditModel(input: string[]): string {
  const base = describeAuditStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
