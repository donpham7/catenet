import { describeMediaAdapter } from "./adapter.ts";

export function describeMediaFactory(count: number): string {
  return `media:factory:${count}`;
}

export function summarizeMediaFactory(input: string[]): string {
  const base = describeMediaAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
