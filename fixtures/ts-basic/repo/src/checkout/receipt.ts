// Default import.
import formatReceipt from "./receipt-format";
import { total } from "./total";

export function receipt(amounts: number[]): string {
  const money = amounts.map((amount) => ({ amount, currency: "USD" }));
  return formatReceipt([total(money)], new Date(0));
}
