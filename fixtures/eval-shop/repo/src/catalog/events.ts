import { describeCatalogRules } from "./rules.ts";

export function describeCatalogEvents(count: number): string {
  return `catalog:events:${count}`;
}

export function summarizeCatalogEvents(input: string[]): string {
  const base = describeCatalogRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
