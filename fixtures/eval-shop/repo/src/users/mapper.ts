import { describeUsersModel } from "./model.ts";

export function describeUsersMapper(count: number): string {
  return `users:mapper:${count}`;
}

export function summarizeUsersMapper(input: string[]): string {
  const base = describeUsersModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
