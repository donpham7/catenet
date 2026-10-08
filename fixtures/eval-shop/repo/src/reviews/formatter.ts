import { describeReviewsValidator } from "./validator.ts";

export function describeReviewsFormatter(count: number): string {
  return `reviews:formatter:${count}`;
}

export function summarizeReviewsFormatter(input: string[]): string {
  const base = describeReviewsValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
