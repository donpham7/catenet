import { describeReturnsAdapter } from "./adapter.ts";

export function describeReturnsFactory(count: number): string {
  return `returns:factory:${count}`;
}

export function summarizeReturnsFactory(input: string[]): string {
  const base = describeReturnsAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
