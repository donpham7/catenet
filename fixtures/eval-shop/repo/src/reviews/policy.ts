import { describeReviewsCache } from "./cache.ts";

export function describeReviewsPolicy(count: number): string {
  return `reviews:policy:${count}`;
}

export function summarizeReviewsPolicy(input: string[]): string {
  const base = describeReviewsCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
