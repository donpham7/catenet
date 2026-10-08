import { describeUsersRegistry } from "./registry.ts";

export function describeUsersAdapter(count: number): string {
  return `users:adapter:${count}`;
}

export function summarizeUsersAdapter(input: string[]): string {
  const base = describeUsersRegistry(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
