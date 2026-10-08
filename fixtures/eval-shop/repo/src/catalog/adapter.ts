import { describeCatalogRegistry } from "./registry.ts";

export function describeCatalogAdapter(count: number): string {
  return `catalog:adapter:${count}`;
}

export function summarizeCatalogAdapter(input: string[]): string {
  const base = describeCatalogRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
