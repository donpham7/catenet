import { describeSupportStore } from "./store.ts";

export function describeSupportModel(count: number): string {
  return `support:model:${count}`;
}

export function summarizeSupportModel(input: string[]): string {
  const base = describeSupportStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
