import { describeSearchMapper } from "./mapper.ts";

export function describeSearchValidator(count: number): string {
  return `search:validator:${count}`;
}

export function summarizeSearchValidator(input: string[]): string {
  const base = describeSearchMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
