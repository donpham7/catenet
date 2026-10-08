import { describeSupportValidator } from "./validator.ts";

export function describeSupportFormatter(count: number): string {
  return `support:formatter:${count}`;
}

export function summarizeSupportFormatter(input: string[]): string {
  const base = describeSupportValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
