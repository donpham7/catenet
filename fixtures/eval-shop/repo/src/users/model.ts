import { describeUsersStore } from "./store.ts";

export function describeUsersModel(count: number): string {
  return `users:model:${count}`;
}

export function summarizeUsersModel(input: string[]): string {
  const base = describeUsersStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
