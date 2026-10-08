import { describeMediaService } from "./service.ts";

export function describeMediaStore(count: number): string {
  return `media:store:${count}`;
}

export function summarizeMediaStore(input: string[]): string {
  const base = describeMediaService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
