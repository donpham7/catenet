import { describeReviewsModel } from "./model.ts";

export function describeReviewsMapper(count: number): string {
  return `reviews:mapper:${count}`;
}

export function summarizeReviewsMapper(input: string[]): string {
  const base = describeReviewsModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
