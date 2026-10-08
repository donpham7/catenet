import { describeSearchFormatter } from "./formatter.ts";

export function describeSearchParser(count: number): string {
  return `search:parser:${count}`;
}

export function summarizeSearchParser(input: string[]): string {
  const base = describeSearchFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
