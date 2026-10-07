import { clamp } from "./lib/math";

(globalThis as Record<string, unknown>).clampPercent = (n: number) => clamp(n, 0, 100);
