export function describeSearchConfig(count: number): string {
  return `search:config:${count}`;
}

export function summarizeSearchConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
