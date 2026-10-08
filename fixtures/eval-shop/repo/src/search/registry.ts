import { describeSearchWorker } from "./worker.ts";

export function describeSearchRegistry(count: number): string {
  return `search:registry:${count}`;
}

export function summarizeSearchRegistry(input: string[]): string {
  const base = describeSearchWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
