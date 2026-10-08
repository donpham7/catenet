import { describeSearchModel } from "./model.ts";

export function describeSearchMapper(count: number): string {
  return `search:mapper:${count}`;
}

export function summarizeSearchMapper(input: string[]): string {
  const base = describeSearchModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
