import { describeReturnsStore } from "./store.ts";

export function describeReturnsModel(count: number): string {
  return `returns:model:${count}`;
}

export function summarizeReturnsModel(input: string[]): string {
  const base = describeReturnsStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
