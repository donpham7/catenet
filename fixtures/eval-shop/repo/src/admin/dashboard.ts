import { getCart } from "../index.ts";

export function cartSizes(ids: string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, getCart(id).items.length]));
}
