import { describeCatalogCache } from "./cache.ts";

export function describeCatalogPolicy(count: number): string {
  return `catalog:policy:${count}`;
}

export function summarizeCatalogPolicy(input: string[]): string {
  const base = describeCatalogCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
