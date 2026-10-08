import { describePlansCache } from "./cache.ts";

export function describePlansPolicy(count: number): string {
  return `plans:policy:${count}`;
}

export function summarizePlansPolicy(input: string[]): string {
  const base = describePlansCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
