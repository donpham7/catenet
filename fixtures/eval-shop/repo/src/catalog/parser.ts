import { describeCatalogFormatter } from "./formatter.ts";

export function describeCatalogParser(count: number): string {
  return `catalog:parser:${count}`;
}

export function summarizeCatalogParser(input: string[]): string {
  const base = describeCatalogFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
