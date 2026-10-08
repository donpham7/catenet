import { describeRatesWorker } from "./worker.ts";

export function describeRatesRegistry(count: number): string {
  return `rates:registry:${count}`;
}

export function summarizeRatesRegistry(input: string[]): string {
  const base = describeRatesWorker(input.length);
  return `${base}|${input.map((s) => s.trim().toLowerCase()).join(",")}`;
}
