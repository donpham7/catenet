import { describeSupportMetrics } from "./metrics.ts";

export function describeSupportHandler(count: number): string {
  return `support:handler:${count}`;
}

export function summarizeSupportHandler(input: string[]): string {
  const base = describeSupportMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
