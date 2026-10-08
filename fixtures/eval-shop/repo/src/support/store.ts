import { describeSupportService } from "./service.ts";

export function describeSupportStore(count: number): string {
  return `support:store:${count}`;
}

export function summarizeSupportStore(input: string[]): string {
  const base = describeSupportService(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
