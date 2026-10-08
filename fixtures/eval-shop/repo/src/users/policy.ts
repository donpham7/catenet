import { describeUsersCache } from "./cache.ts";

export function describeUsersPolicy(count: number): string {
  return `users:policy:${count}`;
}

export function summarizeUsersPolicy(input: string[]): string {
  const base = describeUsersCache(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
