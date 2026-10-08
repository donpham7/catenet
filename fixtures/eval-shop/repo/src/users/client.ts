import { describeUsersParser } from "./parser.ts";

export function describeUsersClient(count: number): string {
  return `users:client:${count}`;
}

export function summarizeUsersClient(input: string[]): string {
  const base = describeUsersParser(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
