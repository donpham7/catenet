export function describeReviewsConfig(count: number): string {
  return `reviews:config:${count}`;
}

export function summarizeReviewsConfig(input: string[]): string {
  const base = String(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
