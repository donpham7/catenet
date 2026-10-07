import { round } from "./math";

export function formatCurrency(n: number): string {
  return `$${round(n).toFixed(2)}`;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
