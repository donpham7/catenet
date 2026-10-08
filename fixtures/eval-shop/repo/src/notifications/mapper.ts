import { describeNotificationsModel } from "./model.ts";

export function describeNotificationsMapper(count: number): string {
  return `notifications:mapper:${count}`;
}

export function summarizeNotificationsMapper(input: string[]): string {
  const base = describeNotificationsModel(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
