import { describeCatalogMapper } from "./mapper.ts";

export function describeCatalogValidator(count: number): string {
  return `catalog:validator:${count}`;
}

export function summarizeCatalogValidator(input: string[]): string {
  const base = describeCatalogMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
