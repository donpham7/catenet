import { describeRatesHandler } from "./handler.ts";

export function describeRatesWorker(count: number): string {
  return `rates:worker:${count}`;
}

export function summarizeRatesWorker(input: string[]): string {
  const base = describeRatesHandler(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
