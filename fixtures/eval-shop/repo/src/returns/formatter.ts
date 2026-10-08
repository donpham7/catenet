import { describeReturnsValidator } from "./validator.ts";

export function describeReturnsFormatter(count: number): string {
  return `returns:formatter:${count}`;
}

export function summarizeReturnsFormatter(input: string[]): string {
  const base = describeReturnsValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
