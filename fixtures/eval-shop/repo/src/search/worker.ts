import { describeSearchHandler } from "./handler.ts";

export function describeSearchWorker(count: number): string {
  return `search:worker:${count}`;
}

export function summarizeSearchWorker(input: string[]): string {
  const base = describeSearchHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
