import { describeReviewsHandler } from "./handler.ts";

export function describeReviewsWorker(count: number): string {
  return `reviews:worker:${count}`;
}

export function summarizeReviewsWorker(input: string[]): string {
  const base = describeReviewsHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
