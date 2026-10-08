import { describeSupportAdapter } from "./adapter.ts";

export function describeSupportFactory(count: number): string {
  return `support:factory:${count}`;
}

export function summarizeSupportFactory(input: string[]): string {
  const base = describeSupportAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
