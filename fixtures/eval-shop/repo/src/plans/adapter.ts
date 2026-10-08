import { describePlansRegistry } from "./registry.ts";

export function describePlansAdapter(count: number): string {
  return `plans:adapter:${count}`;
}

export function summarizePlansAdapter(input: string[]): string {
  const base = describePlansRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
