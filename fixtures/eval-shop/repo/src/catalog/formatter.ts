import { describeCatalogValidator } from "./validator.ts";

export function describeCatalogFormatter(count: number): string {
  return `catalog:formatter:${count}`;
}

export function summarizeCatalogFormatter(input: string[]): string {
  const base = describeCatalogValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
