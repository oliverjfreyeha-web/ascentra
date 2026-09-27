import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The API is the only path to data: pages and components never import the database client.
  {
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/lib/db", "@/lib/db/*", "**/lib/db", "**/lib/db/*"], message: "Pages read data through /api/v1 only." },
            { group: ["@supabase/*"], message: "Pages read data through /api/v1 only." },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "reference/**"]),
]);

export default eslintConfig;
