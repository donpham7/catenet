import { describeSearchService } from "./service.ts";

export function describeSearchStore(count: number): string {
  return `search:store:${count}`;
}

export function summarizeSearchStore(input: string[]): string {
  const base = describeSearchService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
