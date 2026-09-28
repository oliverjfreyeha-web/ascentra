import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration: the real route handlers against real Postgres behind PostgREST (tests/integration/stack.ts).
// Needs TEST_DATABASE_URL and POSTGREST_BIN. Clerk is mocked; everything below it is real.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts", "tests/gate1/routes-by-role.test.ts"],
    environment: "node",
    env: { ASCENTRA_REAL_DB: "1" },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
