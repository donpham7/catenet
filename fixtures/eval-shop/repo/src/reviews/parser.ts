import { describeReviewsFormatter } from "./formatter.ts";

export function describeReviewsParser(count: number): string {
  return `reviews:parser:${count}`;
}

export function summarizeReviewsParser(input: string[]): string {
  const base = describeReviewsFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
