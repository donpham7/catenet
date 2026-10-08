import { describeReturnsHandler } from "./handler.ts";

export function describeReturnsWorker(count: number): string {
  return `returns:worker:${count}`;
}

export function summarizeReturnsWorker(input: string[]): string {
  const base = describeReturnsHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
