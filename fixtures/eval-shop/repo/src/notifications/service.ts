import { describeNotificationsConfig } from "./config.ts";

export function describeNotificationsService(count: number): string {
  return `notifications:service:${count}`;
}

export function summarizeNotificationsService(input: string[]): string {
  const base = describeNotificationsConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
