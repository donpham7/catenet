import { describeNotificationsService } from "./service.ts";

export function describeNotificationsStore(count: number): string {
  return `notifications:store:${count}`;
}

export function summarizeNotificationsStore(input: string[]): string {
  const base = describeNotificationsService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
