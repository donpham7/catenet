import { describeUsersService } from "./service.ts";

export function describeUsersStore(count: number): string {
  return `users:store:${count}`;
}

export function summarizeUsersStore(input: string[]): string {
  const base = describeUsersService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
