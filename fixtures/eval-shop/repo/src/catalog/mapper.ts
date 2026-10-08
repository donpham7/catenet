import { describeCatalogModel } from "./model.ts";

export function describeCatalogMapper(count: number): string {
  return `catalog:mapper:${count}`;
}

export function summarizeCatalogMapper(input: string[]): string {
  const base = describeCatalogModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
