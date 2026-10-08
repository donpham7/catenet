import { describeReviewsMetrics } from "./metrics.ts";

export function describeReviewsHandler(count: number): string {
  return `reviews:handler:${count}`;
}

export function summarizeReviewsHandler(input: string[]): string {
  const base = describeReviewsMetrics(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
