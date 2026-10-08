import { describeReviewsFactory } from "./factory.ts";

export function describeReviewsHelpers(count: number): string {
  return `reviews:helpers:${count}`;
}

export function summarizeReviewsHelpers(input: string[]): string {
  const base = describeReviewsFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
