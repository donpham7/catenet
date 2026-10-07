import { defineConfig } from "vitest/config";

// "source" makes workspace packages resolve to src/*.ts, so tests run without a build step (ADR-0013).
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
