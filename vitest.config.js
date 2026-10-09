import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "**/_generated/**",
        "**/*.test.ts",
        "**/fixtures/**",
        "src/test.ts",
        "src/test-helpers.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
      },
    },
  },
});
