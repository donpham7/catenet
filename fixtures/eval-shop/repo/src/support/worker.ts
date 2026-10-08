import { describeSupportHandler } from "./handler.ts";

export function describeSupportWorker(count: number): string {
  return `support:worker:${count}`;
}

export function summarizeSupportWorker(input: string[]): string {
  const base = describeSupportHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
