import { describeNotificationsStore } from "./store.ts";

export function describeNotificationsModel(count: number): string {
  return `notifications:model:${count}`;
}

export function summarizeNotificationsModel(input: string[]): string {
  const base = describeNotificationsStore(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
