export function describeCatalogConfig(count: number): string {
  return `catalog:config:${count}`;
}

export function summarizeCatalogConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
