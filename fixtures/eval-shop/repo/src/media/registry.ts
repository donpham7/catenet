import { describeMediaWorker } from "./worker.ts";

export function describeMediaRegistry(count: number): string {
  return `media:registry:${count}`;
}

export function summarizeMediaRegistry(input: string[]): string {
  const base = describeMediaWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
