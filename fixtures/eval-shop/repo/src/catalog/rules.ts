import { describeCatalogPolicy } from "./policy.ts";

export function describeCatalogRules(count: number): string {
  return `catalog:rules:${count}`;
}

export function summarizeCatalogRules(input: string[]): string {
  const base = describeCatalogPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
