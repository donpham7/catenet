import { formatCurrency } from "../lib/format";

export function toCsv(rows: number[]): string {
  return rows.map(formatCurrency).join(",");
}
