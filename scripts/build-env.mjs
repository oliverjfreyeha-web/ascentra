import { readFileSync } from "node:fs";

export const SECRET_NAMES = JSON.parse(readFileSync(new URL("../lib/secret-env-names.json", import.meta.url), "utf8")).names;

// Anything else that looks like a credential is removed too, so a new secret can't slip in unlisted.
const LOOKS_SECRET = /SECRET|PRIVATE|PASSWORD|TOKEN|SERVICE_ROLE|(^|_)KEY($|_)|DATABASE_URL|CONNECTION_STRING/i;
const KEEP = /^(NEXT_PUBLIC_|__NEXT_)/;

/** The environment `next build` runs with: the current one minus every secret. */
export function buildEnv(source) {
  const env = {};
  const removed = [];
  for (const [name, value] of Object.entries(source)) {
    if (SECRET_NAMES.includes(name) || (!KEEP.test(name) && LOOKS_SECRET.test(name))) removed.push(name);
    else env[name] = value;
  }
  return { env, removed: removed.sort() };
}
