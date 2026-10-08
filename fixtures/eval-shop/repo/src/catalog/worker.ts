import { describeCatalogHandler } from "./handler.ts";

export function describeCatalogWorker(count: number): string {
  return `catalog:worker:${count}`;
}

export function summarizeCatalogWorker(input: string[]): string {
  const base = describeCatalogHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
