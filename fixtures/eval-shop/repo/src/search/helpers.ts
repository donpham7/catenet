import { describeSearchFactory } from "./factory.ts";

export function describeSearchHelpers(count: number): string {
  return `search:helpers:${count}`;
}

export function summarizeSearchHelpers(input: string[]): string {
  const base = describeSearchFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
