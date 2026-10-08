import { describeReviewsAdapter } from "./adapter.ts";

export function describeReviewsFactory(count: number): string {
  return `reviews:factory:${count}`;
}

export function summarizeReviewsFactory(input: string[]): string {
  const base = describeReviewsAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
