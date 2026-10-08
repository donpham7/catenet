export async function etaLabel(shippedAt: Date, transitDays: number): Promise<string> {
  const { addDays, formatDate } = await import("../utils/date.ts");
  return `arrives ${formatDate(addDays(shippedAt, transitDays))}`;
}
