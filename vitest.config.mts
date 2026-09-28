import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next.js enforces server-only at build time; in unit tests it is a no-op.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts", "tests/gate1/**/*.test.ts"], environment: "node" },
});
