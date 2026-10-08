import { describeMediaRegistry } from "./registry.ts";

export function describeMediaAdapter(count: number): string {
  return `media:adapter:${count}`;
}

export function summarizeMediaAdapter(input: string[]): string {
  const base = describeMediaRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
