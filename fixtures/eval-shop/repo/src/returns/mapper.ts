import { describeReturnsModel } from "./model.ts";

export function describeReturnsMapper(count: number): string {
  return `returns:mapper:${count}`;
}

export function summarizeReturnsMapper(input: string[]): string {
  const base = describeReturnsModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
