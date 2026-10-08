export function describeLoyaltyConfig(count: number): string {
  return `loyalty:config:${count}`;
}

export function summarizeLoyaltyConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
