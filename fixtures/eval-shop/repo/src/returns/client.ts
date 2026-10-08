import { describeReturnsParser } from "./parser.ts";

export function describeReturnsClient(count: number): string {
  return `returns:client:${count}`;
}

export function summarizeReturnsClient(input: string[]): string {
  const base = describeReturnsParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
