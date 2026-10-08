import { describeMediaParser } from "./parser.ts";

export function describeMediaClient(count: number): string {
  return `media:client:${count}`;
}

export function summarizeMediaClient(input: string[]): string {
  const base = describeMediaParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
