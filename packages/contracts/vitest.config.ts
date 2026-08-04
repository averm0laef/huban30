import { defineConfig } from "vitest/config";

/**
 * Explicit config so Vitest stops resolving at this package.
 *
 * Without one it walks up past the repository root and can pick up an
 * unrelated vite.config.ts from a parent directory on the developer's
 * machine, which fails the run for reasons that have nothing to do with
 * this project.
 */
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
