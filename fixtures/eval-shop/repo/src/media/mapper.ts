import { describeMediaModel } from "./model.ts";

export function describeMediaMapper(count: number): string {
  return `media:mapper:${count}`;
}

export function summarizeMediaMapper(input: string[]): string {
  const base = describeMediaModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
