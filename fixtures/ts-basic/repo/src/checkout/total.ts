// Uses formatCurrency through the barrel; type-only import of Money.
import { formatCurrency } from "../lib";
import type { Money } from "../lib/types";

export function total(items: Money[]): string {
  return formatCurrency(items.reduce((sum, m) => sum + m.amount, 0));
}
