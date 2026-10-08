import { describeReviewsPolicy } from "./policy.ts";

export function describeReviewsRules(count: number): string {
  return `reviews:rules:${count}`;
}

export function summarizeReviewsRules(input: string[]): string {
  const base = describeReviewsPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
