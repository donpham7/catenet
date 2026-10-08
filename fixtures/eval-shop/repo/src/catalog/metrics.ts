import { describeCatalogEvents } from "./events.ts";

export function describeCatalogMetrics(count: number): string {
  return `catalog:metrics:${count}`;
}

export function summarizeCatalogMetrics(input: string[]): string {
  const base = describeCatalogEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
