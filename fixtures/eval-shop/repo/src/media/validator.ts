import { describeMediaMapper } from "./mapper.ts";

export function describeMediaValidator(count: number): string {
  return `media:validator:${count}`;
}

export function summarizeMediaValidator(input: string[]): string {
  const base = describeMediaMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
