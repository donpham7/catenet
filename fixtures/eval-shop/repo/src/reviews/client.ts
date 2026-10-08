import { describeReviewsParser } from "./parser.ts";

export function describeReviewsClient(count: number): string {
  return `reviews:client:${count}`;
}

export function summarizeReviewsClient(input: string[]): string {
  const base = describeReviewsParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
