import { describeSupportRules } from "./rules.ts";

export function describeSupportEvents(count: number): string {
  return `support:events:${count}`;
}

export function summarizeSupportEvents(input: string[]): string {
  const base = describeSupportRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
