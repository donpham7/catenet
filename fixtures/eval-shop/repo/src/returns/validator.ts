import { describeReturnsMapper } from "./mapper.ts";

export function describeReturnsValidator(count: number): string {
  return `returns:validator:${count}`;
}

export function summarizeReturnsValidator(input: string[]): string {
  const base = describeReturnsMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
