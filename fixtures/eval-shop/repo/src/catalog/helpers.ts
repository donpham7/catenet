import { describeCatalogFactory } from "./factory.ts";

export function describeCatalogHelpers(count: number): string {
  return `catalog:helpers:${count}`;
}

export function summarizeCatalogHelpers(input: string[]): string {
  const base = describeCatalogFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
