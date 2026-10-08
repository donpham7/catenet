import { describeSearchValidator } from "./validator.ts";

export function describeSearchFormatter(count: number): string {
  return `search:formatter:${count}`;
}

export function summarizeSearchFormatter(input: string[]): string {
  const base = describeSearchValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
