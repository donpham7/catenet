import { describeReturnsWorker } from "./worker.ts";

export function describeReturnsRegistry(count: number): string {
  return `returns:registry:${count}`;
}

export function summarizeReturnsRegistry(input: string[]): string {
  const base = describeReturnsWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
