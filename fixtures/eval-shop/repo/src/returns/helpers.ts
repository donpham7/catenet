import { describeReturnsFactory } from "./factory.ts";

export function describeReturnsHelpers(count: number): string {
  return `returns:helpers:${count}`;
}

export function summarizeReturnsHelpers(input: string[]): string {
  const base = describeReturnsFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
