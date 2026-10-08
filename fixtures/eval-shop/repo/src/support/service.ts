import { describeSupportConfig } from "./config.ts";

export function describeSupportService(count: number): string {
  return `support:service:${count}`;
}

export function summarizeSupportService(input: string[]): string {
  const base = describeSupportConfig(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
