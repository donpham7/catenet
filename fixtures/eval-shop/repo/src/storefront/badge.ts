import { displayPrice } from "../pricing/index.ts";

export function priceBadge(amount: number): string {
  return `[${displayPrice(amount)}]`;
}
