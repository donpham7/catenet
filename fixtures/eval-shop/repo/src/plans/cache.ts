import { describePlansClient } from "./client.ts";

export function describePlansCache(count: number): string {
  return `plans:cache:${count}`;
}

export function summarizePlansCache(input: string[]): string {
  const base = describePlansClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
