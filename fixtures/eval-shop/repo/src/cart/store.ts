import type { Cart, CartItem } from "./types.ts";

const carts = new Map<string, Cart>();

export function getCart(id: string): Cart {
  let cart = carts.get(id);
  if (!cart) {
    cart = { id, items: [] };
    carts.set(id, cart);
  }
  return cart;
}

export function addItem(id: string, item: CartItem): Cart {
  const cart = getCart(id);
  cart.items.push(item);
  return cart;
}

export function clearCarts(): void {
  carts.clear();
}
