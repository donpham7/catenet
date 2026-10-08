import { describeUsersWorker } from "./worker.ts";

export function describeUsersRegistry(count: number): string {
  return `users:registry:${count}`;
}

export function summarizeUsersRegistry(input: string[]): string {
  const base = describeUsersWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
