import { describeCatalogWorker } from "./worker.ts";

export function describeCatalogRegistry(count: number): string {
  return `catalog:registry:${count}`;
}

export function summarizeCatalogRegistry(input: string[]): string {
  const base = describeCatalogWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
