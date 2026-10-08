import { describeCatalogStore } from "./store.ts";

export function describeCatalogModel(count: number): string {
  return `catalog:model:${count}`;
}

export function summarizeCatalogModel(input: string[]): string {
  const base = describeCatalogStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
