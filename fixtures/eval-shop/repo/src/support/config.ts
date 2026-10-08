export function describeSupportConfig(count: number): string {
  return `support:config:${count}`;
}

export function summarizeSupportConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
