import { describePlansPolicy } from "./policy.ts";

export function describePlansRules(count: number): string {
  return `plans:rules:${count}`;
}

export function summarizePlansRules(input: string[]): string {
  const base = describePlansPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
