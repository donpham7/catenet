import { describeSupportWorker } from "./worker.ts";

export function describeSupportRegistry(count: number): string {
  return `support:registry:${count}`;
}

export function summarizeSupportRegistry(input: string[]): string {
  const base = describeSupportWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
