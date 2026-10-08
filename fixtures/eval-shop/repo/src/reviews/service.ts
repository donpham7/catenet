import { describeReviewsConfig } from "./config.ts";

export function describeReviewsService(count: number): string {
  return `reviews:service:${count}`;
}

export function summarizeReviewsService(input: string[]): string {
  const base = describeReviewsConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
