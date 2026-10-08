import { describePlansConfig } from "./config.ts";

export function describePlansService(count: number): string {
  return `plans:service:${count}`;
}

export function summarizePlansService(input: string[]): string {
  const base = describePlansConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
