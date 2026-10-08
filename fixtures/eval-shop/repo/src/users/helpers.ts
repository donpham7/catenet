import { describeUsersFactory } from "./factory.ts";

export function describeUsersHelpers(count: number): string {
  return `users:helpers:${count}`;
}

export function summarizeUsersHelpers(input: string[]): string {
  const base = describeUsersFactory(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
