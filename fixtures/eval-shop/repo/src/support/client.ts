import { describeSupportParser } from "./parser.ts";

export function describeSupportClient(count: number): string {
  return `support:client:${count}`;
}

export function summarizeSupportClient(input: string[]): string {
  const base = describeSupportParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
