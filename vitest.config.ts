import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    maxConcurrency: 2,
    exclude: ["node_modules/**", "dist/**", "src/e2e/**"]
  }
});
