export function describeMediaConfig(count: number): string {
  return `media:config:${count}`;
}

export function summarizeMediaConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
