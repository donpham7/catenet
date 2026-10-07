// Namespace import of the barrel; member access must resolve to format.ts.
import * as lib from "../lib/index";

export function summary(amount: number): string {
  return `Total: ${lib.formatCurrency(amount)}`;
}
