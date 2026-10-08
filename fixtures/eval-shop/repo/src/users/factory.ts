import { describeUsersAdapter } from "./adapter.ts";

export function describeUsersFactory(count: number): string {
  return `users:factory:${count}`;
}

export function summarizeUsersFactory(input: string[]): string {
  const base = describeUsersAdapter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
