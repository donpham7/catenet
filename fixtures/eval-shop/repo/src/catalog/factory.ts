import { describeCatalogAdapter } from "./adapter.ts";

export function describeCatalogFactory(count: number): string {
  return `catalog:factory:${count}`;
}

export function summarizeCatalogFactory(input: string[]): string {
  const base = describeCatalogAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
