// Import cycle: a <-> b. Traversal must terminate.
import { round } from "../lib/math";
import { b } from "./b";

export function a(n: number): number {
  return n > 0 ? b(n - 1) : round(n);
}
