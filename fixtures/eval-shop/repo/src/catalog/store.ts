import { describeCatalogService } from "./service.ts";

export function describeCatalogStore(count: number): string {
  return `catalog:store:${count}`;
}

export function summarizeCatalogStore(input: string[]): string {
  const base = describeCatalogService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
