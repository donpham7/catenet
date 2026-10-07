import { defineConfig } from "vitest/config";

// The "@catenet/source" condition (a name no third-party package uses) makes workspace packages resolve to src/*.ts, so in-process tests run on sources (ADR-0013). The global
// setup still builds dist/ once for tests that spawn real processes (ADR-0014).
export default defineConfig({
  resolve: { conditions: ["@catenet/source"] },
  ssr: { resolve: { conditions: ["@catenet/source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/adapters/*/test/**/*.test.ts"],
    globalSetup: ["./scripts/vitest-build.ts"],
    testTimeout: 20_000,
  },
});
