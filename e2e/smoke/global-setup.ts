/**
 * Live smoke setup (production, on demand from the Actions tab; see .github/workflows/smoke.yml).
 * Test users only: two learners in the production Clerk instance, marked as tests (email prefix
 * ascentra-smoke-, name "TEST …", public metadata ascentra_test: true). Never the Owner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { clerkSetup } from "@clerk/testing/playwright";
import { clerkAdmin, createTestUser, findTestUser, type TestUser } from "../lib/clerk-users";
import { newTotpSecret } from "../lib/totp";
import { randomBytes } from "node:crypto";
import { SMOKE_PREFIX, cleanUp, serviceDb, upsertTestLearner } from "./fixtures";

export const STATE_FILE = "e2e/.state/smoke.json";
const DOMAIN = process.env.SMOKE_EMAIL_DOMAIN || "example.com";

async function ensureUser(label: string): Promise<TestUser & { accountId: string }> {
  const email = `${SMOKE_PREFIX}${label.toLowerCase().replace(/\s+/g, "-")}@${DOMAIN}`;
  const existing = await findTestUser(email, SMOKE_PREFIX);
  let u: TestUser;
  if (existing) {
    // Fresh credentials every run; nothing about the user is kept between runs.
    const password = `T3st-${randomBytes(12).toString("base64url")}`;
    const totpSecret = newTotpSecret();
    await clerkAdmin().users.updateUser(existing.id, { password, skipPasswordChecks: true, totpSecret, signOutOfOtherSessions: true });
    u = { id: existing.id, email, password, totpSecret, raw: null };
  } else {
    u = await createTestUser(email, { label: `ASCENTRA smoke ${label}` });
  }
  const accountId = await upsertTestLearner(serviceDb(), { id: u.id, email, label: `ASCENTRA smoke ${label}` });
  return { ...u, accountId };
}

export default async function globalSetup() {
  const base = process.env.SMOKE_BASE_URL ?? "";
  if (!/^https:\/\//.test(base)) throw new Error("SMOKE_BASE_URL must be the https production URL.");
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
    const clerk = clerkAdmin();
    for (const u of [learnerA, learnerB]) {
      const { data } = await clerk.sessions.getSessionList({ userId: u.id, status: "active" });
      for (const s of data) await clerk.sessions.revokeSession(s.id).catch(() => {});
    }
    const r = await cleanUp(db, { disable: true });
    console.log(`[smoke] cleaned up ${r.accounts} test account(s); audit events stay (append-only).`);
  };
}
