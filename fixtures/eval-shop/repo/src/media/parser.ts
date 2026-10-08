import { describeMediaFormatter } from "./formatter.ts";

export function describeMediaParser(count: number): string {
  return `media:parser:${count}`;
}

export function summarizeMediaParser(input: string[]): string {
  const base = describeMediaFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
