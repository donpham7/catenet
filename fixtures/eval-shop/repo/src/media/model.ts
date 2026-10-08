import { describeMediaStore } from "./store.ts";

export function describeMediaModel(count: number): string {
  return `media:model:${count}`;
}

export function summarizeMediaModel(input: string[]): string {
  const base = describeMediaStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
