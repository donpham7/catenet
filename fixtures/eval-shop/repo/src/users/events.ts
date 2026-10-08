import { describeUsersRules } from "./rules.ts";

export function describeUsersEvents(count: number): string {
  return `users:events:${count}`;
}

export function summarizeUsersEvents(input: string[]): string {
  const base = describeUsersRules(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
