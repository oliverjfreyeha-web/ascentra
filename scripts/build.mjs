// Runs `next build` without server secrets in its environment.
//
// Turbopack writes the entire build-process environment into .next/cache, whether or not
// any code reads a variable. Secrets are only needed at request time, so they are removed here.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildEnv } from "./build-env.mjs";

const { env, removed } = buildEnv(process.env);
console.log(`Building without ${removed.length} secret variable(s): ${removed.join(", ") || "none present"}`);

const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const result = spawnSync(process.execPath, [next, "build"], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
