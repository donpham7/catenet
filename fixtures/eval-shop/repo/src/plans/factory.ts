import { describePlansAdapter } from "./adapter.ts";

export function describePlansFactory(count: number): string {
  return `plans:factory:${count}`;
}

export function summarizePlansFactory(input: string[]): string {
  const base = describePlansAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
