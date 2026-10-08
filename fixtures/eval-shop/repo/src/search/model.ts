import { describeSearchStore } from "./store.ts";

export function describeSearchModel(count: number): string {
  return `search:model:${count}`;
}

export function summarizeSearchModel(input: string[]): string {
  const base = describeSearchStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
