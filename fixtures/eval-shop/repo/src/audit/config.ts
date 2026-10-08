export function describeAuditConfig(count: number): string {
  return `audit:config:${count}`;
}

export function summarizeAuditConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
