import { describeReviewsRules } from "./rules.ts";

export function describeReviewsEvents(count: number): string {
  return `reviews:events:${count}`;
}

export function summarizeReviewsEvents(input: string[]): string {
  const base = describeReviewsRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
