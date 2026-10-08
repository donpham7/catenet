import { describePlansParser } from "./parser.ts";

export function describePlansClient(count: number): string {
  return `plans:client:${count}`;
}

export function summarizePlansClient(input: string[]): string {
  const base = describePlansParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
