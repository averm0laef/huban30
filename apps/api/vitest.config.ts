import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: "node",
    // The real-database suites (CATALOG_SEARCH_DATABASE_URL) share one scratch
    // database and each re-creates the same fixtures; two files doing that at
    // once delete each other's rows. With the scratch database in use, files
    // run one at a time; the ordinary unit run stays parallel.
    fileParallelism: !process.env.CATALOG_SEARCH_DATABASE_URL,
    include: ["src/**/*.test.ts"],
  },
});
