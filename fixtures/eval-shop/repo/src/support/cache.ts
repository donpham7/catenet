import { describeSupportClient } from "./client.ts";

export function describeSupportCache(count: number): string {
  return `support:cache:${count}`;
}

export function summarizeSupportCache(input: string[]): string {
  const base = describeSupportClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
