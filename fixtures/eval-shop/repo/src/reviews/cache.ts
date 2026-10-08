import { describeReviewsClient } from "./client.ts";

export function describeReviewsCache(count: number): string {
  return `reviews:cache:${count}`;
}

export function summarizeReviewsCache(input: string[]): string {
  const base = describeReviewsClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
