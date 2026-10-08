import { describeUsersFormatter } from "./formatter.ts";

export function describeUsersParser(count: number): string {
  return `users:parser:${count}`;
}

export function summarizeUsersParser(input: string[]): string {
  const base = describeUsersFormatter(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
