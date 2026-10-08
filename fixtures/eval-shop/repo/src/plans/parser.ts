import { describePlansFormatter } from "./formatter.ts";

export function describePlansParser(count: number): string {
  return `plans:parser:${count}`;
}

export function summarizePlansParser(input: string[]): string {
  const base = describePlansFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
