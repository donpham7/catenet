import { describeSupportModel } from "./model.ts";

export function describeSupportMapper(count: number): string {
  return `support:mapper:${count}`;
}

export function summarizeSupportMapper(input: string[]): string {
  const base = describeSupportModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
