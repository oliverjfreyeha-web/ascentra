import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests: real Postgres (TEST_DATABASE_URL), one fresh database per test file.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    // Roles are cluster-wide; creating them from parallel files could race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
