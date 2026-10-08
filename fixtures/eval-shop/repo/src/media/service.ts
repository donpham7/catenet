import { describeMediaConfig } from "./config.ts";

export function describeMediaService(count: number): string {
  return `media:service:${count}`;
}

export function summarizeMediaService(input: string[]): string {
  const base = describeMediaConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
