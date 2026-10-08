import { describePlansWorker } from "./worker.ts";

export function describePlansRegistry(count: number): string {
  return `plans:registry:${count}`;
}

export function summarizePlansRegistry(input: string[]): string {
  const base = describePlansWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
