import { describePlansMetrics } from "./metrics.ts";

export function describePlansHandler(count: number): string {
  return `plans:handler:${count}`;
}

export function summarizePlansHandler(input: string[]): string {
  const base = describePlansMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
