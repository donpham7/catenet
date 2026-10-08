export function describePlansConfig(count: number): string {
  return `plans:config:${count}`;
}

export function summarizePlansConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
