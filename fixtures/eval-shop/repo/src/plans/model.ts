import { describePlansStore } from "./store.ts";

export function describePlansModel(count: number): string {
  return `plans:model:${count}`;
}

export function summarizePlansModel(input: string[]): string {
  const base = describePlansStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
