import { describeMediaClient } from "./client.ts";

export function describeMediaCache(count: number): string {
  return `media:cache:${count}`;
}

export function summarizeMediaCache(input: string[]): string {
  const base = describeMediaClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
