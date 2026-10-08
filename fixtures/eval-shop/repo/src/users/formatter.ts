import { describeUsersValidator } from "./validator.ts";

export function describeUsersFormatter(count: number): string {
  return `users:formatter:${count}`;
}

export function summarizeUsersFormatter(input: string[]): string {
  const base = describeUsersValidator(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
