import { describeSearchAdapter } from "./adapter.ts";

export function describeSearchFactory(count: number): string {
  return `search:factory:${count}`;
}

export function summarizeSearchFactory(input: string[]): string {
  const base = describeSearchAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
