import { describeReturnsService } from "./service.ts";

export function describeReturnsStore(count: number): string {
  return `returns:store:${count}`;
}

export function summarizeReturnsStore(input: string[]): string {
  const base = describeReturnsService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
