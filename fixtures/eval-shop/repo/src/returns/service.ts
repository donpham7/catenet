import { describeReturnsConfig } from "./config.ts";

export function describeReturnsService(count: number): string {
  return `returns:service:${count}`;
}

export function summarizeReturnsService(input: string[]): string {
  const base = describeReturnsConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
