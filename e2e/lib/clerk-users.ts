import { randomBytes } from "node:crypto";
import { createClerkClient, type User } from "@clerk/backend";
import { newTotpSecret } from "./totp";

/**
 * Test users in a Clerk instance, created through the Backend API. Every one is marked as a test:
 * the email starts with the given prefix, the name says TEST, and public metadata carries
 * ascentra_test: true. Nothing here touches a user that isn't marked that way.
 */
export type TestUser = { id: string; email: string; password: string; totpSecret: string; raw: unknown };

export const clerkAdmin = () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set.");
  return createClerkClient({ secretKey });
};

const isTestUser = (u: User, prefix: string) =>
  u.emailAddresses.some((e) => e.emailAddress.startsWith(prefix)) && (u.publicMetadata as Record<string, unknown>)?.ascentra_test === true;

export async function createTestUser(email: string, opts: { label: string; metadata?: Record<string, unknown>; secondFactor?: boolean }): Promise<TestUser> {
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

/** Deletes every user marked as a test whose email starts with the prefix. */
export async function deleteTestUsers(prefix: string, protectEmail?: string): Promise<number> {
  const c = clerkAdmin();
  let n = 0;
  const { data } = await c.users.getUserList({ query: prefix, limit: 100 });
  for (const u of data) {
    if (!isTestUser(u, prefix)) continue;
    if (protectEmail && u.emailAddresses.some((e) => e.emailAddress.toLowerCase() === protectEmail.toLowerCase())) {
      throw new Error("Refusing to delete a user with the Owner's email.");
    }
    await c.users.deleteUser(u.id);
    n++;
  }
  return n;
}

export async function findTestUser(email: string, prefix: string): Promise<User | null> {
  const { data } = await clerkAdmin().users.getUserList({ emailAddress: [email], limit: 1 });
  const u = data[0];
  return u && isTestUser(u, prefix) ? u : null;
}

export async function rawUser(id: string): Promise<unknown> {
  return (await clerkAdmin().users.getUser(id)).raw;
}
