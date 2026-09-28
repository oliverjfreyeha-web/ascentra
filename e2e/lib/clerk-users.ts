import { randomBytes } from "node:crypto";
import { createClerkClient, type User } from "@clerk/backend";
import { newTotpSecret } from "./totp";

/**
 * Test users in the Clerk instance, through the Backend API.
 *
 * There is ONE Clerk instance: the live site, the journeys and the smoke all use it, and it holds the
 * real Owner. So every function here that creates, changes, signs out or deletes a user goes through
 * guardTestUser(), which refuses unless ALL of these hold:
 *   - OWNER_EMAIL is set (the real Owner's email), and the user has no email equal to it;
 *   - the user is not any Clerk user that has the Owner's email (checked by id, looked up live);
 *   - every email on the user starts with a test prefix (ascentra-e2e- or ascentra-smoke-);
 *   - for existing users, public metadata carries ascentra_test: true (set when we create them).
 * The Clerk key's type (sk_test_) is not a guard: the real Owner lives in that same instance.
 */
export type TestUser = { id: string; email: string; password: string; totpSecret: string; raw: unknown };

export const TEST_PREFIXES = ["ascentra-e2e-", "ascentra-smoke-"] as const;

const clerkAdmin = () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set.");
  return createClerkClient({ secretKey });
};

function ownerEmail(): string {
  const e = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!e.includes("@")) throw new Error("OWNER_EMAIL must be set to the real Owner's email: it's what keeps these tests away from the Owner.");
  return e;
}

let ownerIds: Set<string> | null = null;
/** The Clerk user id(s) holding the Owner's email, looked up once per run. */
async function ownerClerkIds(): Promise<Set<string>> {
  if (!ownerIds) {
    const { data } = await clerkAdmin().users.getUserList({ emailAddress: [ownerEmail()], limit: 10 });
    ownerIds = new Set(data.map((u) => u.id));
  }
  return ownerIds;
}

/** Refuses an email that isn't a test email, or is the Owner's. */
export function guardTestEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (e === ownerEmail()) throw new Error("Refusing: that is the Owner's email.");
  if (!TEST_PREFIXES.some((p) => e.startsWith(p))) throw new Error(`Refusing: ${email} isn't a test email (${TEST_PREFIXES.join(", ")}).`);
}

async function guardTestUser(u: User) {
  if ((await ownerClerkIds()).has(u.id)) throw new Error("Refusing: that is the Owner's Clerk user.");
  if (!u.emailAddresses.length) throw new Error("Refusing: a user with no email isn't a test user.");
  for (const e of u.emailAddresses) guardTestEmail(e.emailAddress);
  if ((u.publicMetadata as Record<string, unknown>)?.ascentra_test !== true) throw new Error("Refusing: the user isn't marked ascentra_test.");
}

export async function createTestUser(email: string, opts: { label: string; metadata?: Record<string, unknown>; secondFactor?: boolean }): Promise<TestUser> {
  guardTestEmail(email);
  await ownerClerkIds();
  const password = `T3st-${randomBytes(12).toString("base64url")}`;
  const totpSecret = newTotpSecret();
  const u = await clerkAdmin().users.createUser({
    emailAddress: [email], password, firstName: "TEST", lastName: opts.label,
    publicMetadata: { ascentra_test: true, ...(opts.metadata ?? {}) },
    ...(opts.secondFactor === false ? {} : { totpSecret }),
    skipPasswordChecks: true,
  });
  return { id: u.id, email, password, totpSecret, raw: u.raw };
}

/** An existing test user, or null. Never returns a user that fails the guard. */
export async function findTestUser(email: string): Promise<User | null> {
  guardTestEmail(email);
  const { data } = await clerkAdmin().users.getUserList({ emailAddress: [email], limit: 1 });
  const u = data[0];
  if (!u) return null;
  await guardTestUser(u);
  return u;
}

/** New password and authenticator secret for an existing test user; signs it out everywhere. */
export async function resetTestUser(u: User, email: string): Promise<TestUser> {
  await guardTestUser(u);
  const password = `T3st-${randomBytes(12).toString("base64url")}`;
  const totpSecret = newTotpSecret();
  await clerkAdmin().users.updateUser(u.id, { password, skipPasswordChecks: true, totpSecret, signOutOfOtherSessions: true });
  return { id: u.id, email, password, totpSecret, raw: null };
}

/** Revokes every active Clerk session of a test user. */
export async function signOutTestUser(id: string): Promise<void> {
  const c = clerkAdmin();
  await guardTestUser(await c.users.getUser(id));
  const { data } = await c.sessions.getSessionList({ userId: id, status: "active" });
  for (const s of data) await c.sessions.revokeSession(s.id).catch(() => {});
}

/** Deletes every test user whose email starts with the prefix (each one passes the guard first). */
export async function deleteTestUsers(prefix: (typeof TEST_PREFIXES)[number]): Promise<number> {
  const c = clerkAdmin();
  let n = 0;
  const { data } = await c.users.getUserList({ query: prefix, limit: 100 });
  for (const u of data) {
    if (!u.emailAddresses.some((e) => e.emailAddress.startsWith(prefix))) continue;
    if ((u.publicMetadata as Record<string, unknown>)?.ascentra_test !== true) continue;
    await guardTestUser(u);
    await c.users.deleteUser(u.id);
    n++;
  }
  return n;
}

/** Revokes pending Clerk invitations sent to test emails with the prefix (the journeys' admin invites). */
export async function revokeTestInvitations(prefix: (typeof TEST_PREFIXES)[number]): Promise<number> {
  const c = clerkAdmin();
  const { data } = await c.invitations.getInvitationList({ status: "pending", limit: 100 });
  let n = 0;
  for (const inv of data) {
    if (!inv.emailAddress.startsWith(prefix)) continue;
    guardTestEmail(inv.emailAddress);
    await c.invitations.revokeInvitation(inv.id);
    n++;
  }
  return n;
}

export async function rawUser(id: string): Promise<unknown> {
  const u = await clerkAdmin().users.getUser(id);
  await guardTestUser(u);
  return u.raw;
}
