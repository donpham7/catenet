import { describeSearchParser } from "./parser.ts";

export function describeSearchClient(count: number): string {
  return `search:client:${count}`;
}

export function summarizeSearchClient(input: string[]): string {
  const base = describeSearchParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
