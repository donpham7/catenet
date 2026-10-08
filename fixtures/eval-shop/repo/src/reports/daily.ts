export async function dailySummary(totals: number[]): Promise<string> {
  const { formatPrice } = await import("../money/format.ts");
  const sum = totals.reduce((a, b) => a + b, 0);
  return `${totals.length} orders, ${formatPrice(sum)}`;
}
