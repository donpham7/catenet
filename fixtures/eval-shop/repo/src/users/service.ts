import { describeUsersConfig } from "./config.ts";

export function describeUsersService(count: number): string {
  return `users:service:${count}`;
}

export function summarizeUsersService(input: string[]): string {
  const base = describeUsersConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
