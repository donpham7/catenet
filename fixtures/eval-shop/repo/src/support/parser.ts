import { describeSupportFormatter } from "./formatter.ts";

export function describeSupportParser(count: number): string {
  return `support:parser:${count}`;
}

export function summarizeSupportParser(input: string[]): string {
  const base = describeSupportFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
