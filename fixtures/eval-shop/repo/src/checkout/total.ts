import { getCart } from "../cart/store.ts";
import { applyTax, formatPrice } from "../money/index.ts";

export function cartSubtotal(cartId: string): number {
  return getCart(cartId).items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function checkoutTotal(cartId: string, taxRate = 0): string {
  return formatPrice(applyTax(cartSubtotal(cartId), taxRate));
}
