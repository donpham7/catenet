import { describePlansRules } from "./rules.ts";

export function describePlansEvents(count: number): string {
  return `plans:events:${count}`;
}

export function summarizePlansEvents(input: string[]): string {
  const base = describePlansRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
