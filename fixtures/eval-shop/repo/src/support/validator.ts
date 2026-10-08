import { describeSupportMapper } from "./mapper.ts";

export function describeSupportValidator(count: number): string {
  return `support:validator:${count}`;
}

export function summarizeSupportValidator(input: string[]): string {
  const base = describeSupportMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
