import { describeMediaHandler } from "./handler.ts";

export function describeMediaWorker(count: number): string {
  return `media:worker:${count}`;
}

export function summarizeMediaWorker(input: string[]): string {
  const base = describeMediaHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
