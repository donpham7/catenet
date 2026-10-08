export function describeInventoryConfig(count: number): string {
  return `inventory:config:${count}`;
}

export function summarizeInventoryConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
