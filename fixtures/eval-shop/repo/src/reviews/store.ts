import { describeReviewsService } from "./service.ts";

export function describeReviewsStore(count: number): string {
  return `reviews:store:${count}`;
}

export function summarizeReviewsStore(input: string[]): string {
  const base = describeReviewsService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
