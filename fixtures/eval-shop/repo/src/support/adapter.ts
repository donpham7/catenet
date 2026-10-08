import { describeSupportRegistry } from "./registry.ts";

export function describeSupportAdapter(count: number): string {
  return `support:adapter:${count}`;
}

export function summarizeSupportAdapter(input: string[]): string {
  const base = describeSupportRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
