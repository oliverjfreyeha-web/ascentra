/**
 * Journeys environment (CI only; see .github/workflows/journeys.yml):
 *   - a fresh local database with every migration, behind PostgREST (tests/integration/stack.ts);
 *   - the one Clerk instance (the same one the live site uses), with test users created for this run;
 *   - the built app (`next start`) pointed at both, with a TEST Owner (ascentra-e2e-owner+clerk_test@…)
 *     as OWNER_EMAIL for this local server only.
 * The real Owner is in that Clerk instance, so it is protected by e2e/lib/clerk-users.ts: every user
 * this run creates, changes or deletes must have a test email, be marked ascentra_test, and must not be
 * (by email or by Clerk id) the Owner named in OWNER_EMAIL. The local server never sees the real Owner:
 * its database is fresh and only the test Owner is seeded.
 * Clerk can't reach a local server, so the harness delivers the webhook itself, signed with this run's
 * secret, carrying the real user JSON from Clerk.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { clerkSetup } from "@clerk/testing/playwright";
import { startStack } from "../../tests/integration/stack";
import { clearTestEmails, createTestUser, deleteTestUsers, guardTestEmail, revokeTestInvitations } from "../lib/clerk-users";
import { deliverUserEvent } from "../lib/webhook";
import { E2E_PREFIX, STATE_FILE } from "./constants";

const PORT = 3100;

export default async function globalSetup() {
  // OWNER_EMAIL here is the REAL Owner's email, used only to keep away from that user.
  const realOwner = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!realOwner.includes("@")) throw new Error("OWNER_EMAIL (the real Owner's email) must be set: it's what keeps the journeys away from the Owner.");
  await clerkSetup();

  const stack = await startStack();
  await deleteTestUsers(E2E_PREFIX);
  await revokeTestInvitations(E2E_PREFIX);
  // The emails the journeys invite or create: nothing may be left of them from an earlier run.
  await clearTestEmails([`${E2E_PREFIX}support+clerk_test@example.com`, `${E2E_PREFIX}replay+clerk_test@example.com`]);
  const testOwnerEmail = `${E2E_PREFIX}owner+clerk_test@example.com`;
  guardTestEmail(testOwnerEmail);
  const owner = await createTestUser(testOwnerEmail, { label: "E2E Owner" });

  const webhookSecret = `whsec_${randomBytes(24).toString("base64")}`;
  // Listen on every interface and use "localhost": Next.js and Clerk call back to localhost:<port>,
  // which can resolve to ::1. Bound to 127.0.0.1 only, those calls hang ("Failed to proxy … socket hang up").
  const baseURL = `http://localhost:${PORT}`;
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
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
    await revokeTestInvitations(E2E_PREFIX).catch((e) => console.error("cleanup:", e));
    await deleteTestUsers(E2E_PREFIX).catch((e) => console.error("cleanup:", e));
    await stack.stop();
  };
}
