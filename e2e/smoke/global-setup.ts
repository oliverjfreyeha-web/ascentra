/**
 * Live smoke setup (the live site, on demand from the Actions tab; see .github/workflows/smoke.yml).
 * Test users only: two learners in the one Clerk instance (shared with the live site, the journeys and
 * the real Owner), marked as tests: email ascentra-smoke-…+clerk_test@example.com, name "TEST …",
 * public metadata ascentra_test: true. e2e/lib/clerk-users.ts refuses to touch the Owner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { clerkSetup } from "@clerk/testing/playwright";
import { createTestUser, findTestUser, resetTestUser, signOutTestUser, type TestUser } from "../lib/clerk-users";
import { SMOKE_PREFIX, cleanUp, serviceDb, upsertTestLearner } from "./fixtures";

export const STATE_FILE = "e2e/.state/smoke.json";
// +clerk_test: Clerk's test-email convention (no email is ever sent).
const DOMAIN = "example.com";

async function ensureUser(label: string): Promise<TestUser & { accountId: string }> {
  const email = `${SMOKE_PREFIX}${label.toLowerCase().replace(/\s+/g, "-")}+clerk_test@${DOMAIN}`;
  const existing = await findTestUser(email);
  let u: TestUser;
  if (existing) {
    // Fresh credentials every run; nothing about the user is kept between runs.
    u = await resetTestUser(existing, email);
  } else {
    u = await createTestUser(email, { label: `ASCENTRA smoke ${label}` });
  }
  const accountId = await upsertTestLearner(serviceDb(), { id: u.id, email, label: `ASCENTRA smoke ${label}` });
  return { ...u, accountId };
}

export default async function globalSetup() {
  const base = process.env.SMOKE_BASE_URL ?? "";
  if (!/^https:\/\//.test(base)) throw new Error("SMOKE_BASE_URL must be the https URL of the live site.");
  if (!process.env.OWNER_EMAIL) throw new Error("OWNER_EMAIL is required (the suite proves it never touches the Owner).");
  await clerkSetup();

  const db = serviceDb();
  await cleanUp(db, { disable: false });
  const runStart = new Date().toISOString();
  const learnerA = await ensureUser("learner a");
  const learnerB = await ensureUser("learner b");
  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;

  mkdirSync("e2e/.state", { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ base, runId, runStart, learnerA, learnerB }, null, 2));

  return async () => {
    // Sign the test users out everywhere and remove what the run created (audit events stay).
    for (const u of [learnerA, learnerB]) await signOutTestUser(u.id);
    const r = await cleanUp(db, { disable: true });
    console.log(`[smoke] cleaned up ${r.accounts} test account(s); audit events stay (append-only).`);
  };
}
