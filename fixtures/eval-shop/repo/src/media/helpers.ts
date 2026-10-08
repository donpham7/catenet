import { describeMediaFactory } from "./factory.ts";

export function describeMediaHelpers(count: number): string {
  return `media:helpers:${count}`;
}

export function summarizeMediaHelpers(input: string[]): string {
  const base = describeMediaFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
