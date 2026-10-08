import { describeCatalogClient } from "./client.ts";

export function describeCatalogCache(count: number): string {
  return `catalog:cache:${count}`;
}

export function summarizeCatalogCache(input: string[]): string {
  const base = describeCatalogClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
