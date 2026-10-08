export function describeReturnsConfig(count: number): string {
  return `returns:config:${count}`;
}

export function summarizeReturnsConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
