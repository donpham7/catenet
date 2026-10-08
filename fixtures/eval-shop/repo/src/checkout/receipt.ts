import type { CartItem } from "../cart/types.ts";
import { price } from "../money/index.ts";

export function receiptLines(items: CartItem[]): string[] {
  return items.map((item) => `${item.quantity} x ${item.sku} @ ${price(item.price)}`);
}
