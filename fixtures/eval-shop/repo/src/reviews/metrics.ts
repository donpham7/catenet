import { describeReviewsEvents } from "./events.ts";

export function describeReviewsMetrics(count: number): string {
  return `reviews:metrics:${count}`;
}

export function summarizeReviewsMetrics(input: string[]): string {
  const base = describeReviewsEvents(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
