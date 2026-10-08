export function describePromotionsConfig(count: number): string {
  return `promotions:config:${count}`;
}

export function summarizePromotionsConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
