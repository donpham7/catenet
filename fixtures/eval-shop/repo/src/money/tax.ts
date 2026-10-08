import { roundCents } from "./format.ts";

export function applyTax(amount: number, rate: number): number {
  return roundCents(amount * (1 + rate));
}
