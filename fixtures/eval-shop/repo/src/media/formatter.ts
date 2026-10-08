import { describeMediaValidator } from "./validator.ts";

export function describeMediaFormatter(count: number): string {
  return `media:formatter:${count}`;
}

export function summarizeMediaFormatter(input: string[]): string {
  const base = describeMediaValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
