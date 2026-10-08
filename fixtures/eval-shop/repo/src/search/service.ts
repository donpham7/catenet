import { describeSearchConfig } from "./config.ts";

export function describeSearchService(count: number): string {
  return `search:service:${count}`;
}

export function summarizeSearchService(input: string[]): string {
  const base = describeSearchConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
