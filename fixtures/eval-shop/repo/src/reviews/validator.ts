import { describeReviewsMapper } from "./mapper.ts";

export function describeReviewsValidator(count: number): string {
  return `reviews:validator:${count}`;
}

export function summarizeReviewsValidator(input: string[]): string {
  const base = describeReviewsMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
