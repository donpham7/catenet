import { describePlansHandler } from "./handler.ts";

export function describePlansWorker(count: number): string {
  return `plans:worker:${count}`;
}

export function summarizePlansWorker(input: string[]): string {
  const base = describePlansHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
