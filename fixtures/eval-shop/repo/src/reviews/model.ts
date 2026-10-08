import { describeReviewsStore } from "./store.ts";

export function describeReviewsModel(count: number): string {
  return `reviews:model:${count}`;
}

export function summarizeReviewsModel(input: string[]): string {
  const base = describeReviewsStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
