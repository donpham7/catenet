import { describeUsersClient } from "./client.ts";

export function describeUsersCache(count: number): string {
  return `users:cache:${count}`;
}

export function summarizeUsersCache(input: string[]): string {
  const base = describeUsersClient(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
