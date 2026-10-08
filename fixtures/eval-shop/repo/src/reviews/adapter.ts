import { describeReviewsRegistry } from "./registry.ts";

export function describeReviewsAdapter(count: number): string {
  return `reviews:adapter:${count}`;
}

export function summarizeReviewsAdapter(input: string[]): string {
  const base = describeReviewsRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
