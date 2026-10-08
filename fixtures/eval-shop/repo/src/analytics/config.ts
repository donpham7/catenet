export function describeAnalyticsConfig(count: number): string {
  return `analytics:config:${count}`;
}

export function summarizeAnalyticsConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
