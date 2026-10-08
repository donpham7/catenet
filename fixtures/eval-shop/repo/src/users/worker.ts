import { describeUsersHandler } from "./handler.ts";

export function describeUsersWorker(count: number): string {
  return `users:worker:${count}`;
}

export function summarizeUsersWorker(input: string[]): string {
  const base = describeUsersHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
