import { describeUsersPolicy } from "./policy.ts";

export function describeUsersRules(count: number): string {
  return `users:rules:${count}`;
}

export function summarizeUsersRules(input: string[]): string {
  const base = describeUsersPolicy(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
