import { describeCatalogMetrics } from "./metrics.ts";

export function describeCatalogHandler(count: number): string {
  return `catalog:handler:${count}`;
}

export function summarizeCatalogHandler(input: string[]): string {
  const base = describeCatalogMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
