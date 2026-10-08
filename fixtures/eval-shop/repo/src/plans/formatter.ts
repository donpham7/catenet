import { describePlansValidator } from "./validator.ts";

export function describePlansFormatter(count: number): string {
  return `plans:formatter:${count}`;
}

export function summarizePlansFormatter(input: string[]): string {
  const base = describePlansValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
