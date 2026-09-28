/**
 * Journeys environment (CI only; see .github/workflows/journeys.yml):
 *   - a fresh local database with every migration, behind PostgREST (tests/integration/stack.ts);
 *   - the Clerk DEVELOPMENT instance (never production), with test users created for this run;
 *   - the built app (`next start`) pointed at both, with a test Owner whose email is OWNER_EMAIL here.
 * Clerk can't reach a local server, so the harness delivers the webhook itself, signed with this run's
 * secret, carrying the real user JSON from Clerk.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { clerkSetup } from "@clerk/testing/playwright";
import { startStack } from "../../tests/integration/stack";
import { createTestUser, deleteTestUsers } from "../lib/clerk-users";
import { deliverUserEvent } from "../lib/webhook";
import { E2E_PREFIX, STATE_FILE } from "./constants";

const PORT = 3100;

export default async function globalSetup() {
  const sk = process.env.CLERK_SECRET_KEY ?? "";
  if (!sk.startsWith("sk_test_")) throw new Error("Journeys run only against a Clerk DEVELOPMENT instance (sk_test_...).");
  await clerkSetup();

  const stack = await startStack();
  await deleteTestUsers(E2E_PREFIX);
  const owner = await createTestUser(`${E2E_PREFIX}owner+clerk_test@example.com`, { label: "E2E Owner" });

  const webhookSecret = `whsec_${randomBytes(24).toString("base64")}`;
  const baseURL = `http://127.0.0.1:${PORT}`;
  const server = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: {
      ...process.env,
      SUPABASE_URL: stack.url,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      CLERK_WEBHOOK_SIGNING_SECRET: webhookSecret,
      OWNER_EMAIL: owner.email,
      CRON_SECRET: randomBytes(24).toString("hex"),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${baseURL}/api/v1/health`)).status < 500) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("next start didn't come up");
    await new Promise((r) => setTimeout(r, 500));
  }

  // The Owner's first sync, as Clerk's user.created webhook would deliver it.
  const outcome = await deliverUserEvent(baseURL, webhookSecret, "user.created", owner.raw);
  if (outcome !== "owner_seeded") throw new Error(`Owner not seeded: ${outcome}`);

  mkdirSync("e2e/.state", { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ baseURL, dbUrl: stack.db.url, webhookSecret, owner }, null, 2));
  process.env.E2E_BASE_URL = baseURL;

  return async () => {
    server.kill();
    await deleteTestUsers(E2E_PREFIX).catch((e) => console.error("cleanup:", e));
    await stack.stop();
  };
}
