import { describeCatalogConfig } from "./config.ts";

export function describeCatalogService(count: number): string {
  return `catalog:service:${count}`;
}

export function summarizeCatalogService(input: string[]): string {
  const base = describeCatalogConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
