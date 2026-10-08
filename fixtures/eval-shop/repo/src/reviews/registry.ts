import { describeReviewsWorker } from "./worker.ts";

export function describeReviewsRegistry(count: number): string {
  return `reviews:registry:${count}`;
}

export function summarizeReviewsRegistry(input: string[]): string {
  const base = describeReviewsWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
