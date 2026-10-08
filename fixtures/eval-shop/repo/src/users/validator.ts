import { describeUsersMapper } from "./mapper.ts";

export function describeUsersValidator(count: number): string {
  return `users:validator:${count}`;
}

export function summarizeUsersValidator(input: string[]): string {
  const base = describeUsersMapper(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
