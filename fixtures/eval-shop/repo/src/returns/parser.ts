import { describeReturnsFormatter } from "./formatter.ts";

export function describeReturnsParser(count: number): string {
  return `returns:parser:${count}`;
}

export function summarizeReturnsParser(input: string[]): string {
  const base = describeReturnsFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
