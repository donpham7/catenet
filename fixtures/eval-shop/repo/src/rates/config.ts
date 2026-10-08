export function describeRatesConfig(count: number): string {
  return `rates:config:${count}`;
}

export function summarizeRatesConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
