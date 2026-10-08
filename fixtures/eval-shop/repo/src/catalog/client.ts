import { describeCatalogParser } from "./parser.ts";

export function describeCatalogClient(count: number): string {
  return `catalog:client:${count}`;
}

export function summarizeCatalogClient(input: string[]): string {
  const base = describeCatalogParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
