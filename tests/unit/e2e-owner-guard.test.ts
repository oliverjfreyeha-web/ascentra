/**
 * The journeys and the live smoke share one Clerk instance with the real Owner. e2e/lib/clerk-users.ts
 * must refuse to create, change, sign out or delete the Owner, whatever the Owner's user looks like,
 * including the worst case: an Owner user that also carries a test-looking email and the test marker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type U = { id: string; emailAddresses: { emailAddress: string }[]; publicMetadata: Record<string, unknown>; raw: unknown };
const clerk = vi.hoisted(() => ({ users: [] as U[], calls: [] as string[] }));
vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    users: {
      getUserList: async (p: { emailAddress?: string[]; query?: string }) => ({
        data: clerk.users.filter((u) =>
          p.emailAddress ? u.emailAddresses.some((e) => p.emailAddress!.includes(e.emailAddress.toLowerCase()))
            : u.emailAddresses.some((e) => e.emailAddress.includes(p.query ?? ""))),
      }),
      getUser: async (id: string) => clerk.users.find((u) => u.id === id)!,
      createUser: async (p: { emailAddress: string[] }) => {
        clerk.calls.push(`create ${p.emailAddress[0]}`);
        const u = { id: `user_${clerk.users.length}`, emailAddresses: [{ emailAddress: p.emailAddress[0] }], publicMetadata: { ascentra_test: true }, raw: {} };
        clerk.users.push(u);
        return u;
      },
      updateUser: async (id: string) => void clerk.calls.push(`update ${id}`),
      deleteUser: async (id: string) => void clerk.calls.push(`delete ${id}`),
    },
    sessions: { getSessionList: async () => ({ data: [{ id: "sess_1" }] }), revokeSession: async (id: string) => void clerk.calls.push(`revoke ${id}`) },
    invitations: {
      getInvitationList: async () => ({ data: [{ id: "inv_owner", emailAddress: "owner@example.com" }, { id: "inv_e2e", emailAddress: "ascentra-e2e-support+clerk_test@example.com" }] }),
      revokeInvitation: async (id: string) => void clerk.calls.push(`revoke-invite ${id}`),
    },
  }),
}));

import { createTestUser, deleteTestUsers, findTestUser, guardTestEmail, resetTestUser, revokeTestInvitations, signOutTestUser } from "../../e2e/lib/clerk-users";

const OWNER: U = {
  id: "user_owner",
  // Worst case: the Owner's user also has a test-looking address and the test marker.
  emailAddresses: [{ emailAddress: "owner@example.com" }, { emailAddress: "ascentra-e2e-owner-alias@example.com" }],
  publicMetadata: { ascentra_test: true }, raw: {},
};
const TEST: U = { id: "user_e2e", emailAddresses: [{ emailAddress: "ascentra-e2e-support+clerk_test@example.com" }], publicMetadata: { ascentra_test: true }, raw: {} };

beforeEach(() => {
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_shared_instance");
  vi.stubEnv("OWNER_EMAIL", "Owner@Example.com");
  clerk.users = [OWNER, TEST];
  clerk.calls = [];
});

describe("the Owner guard on the shared Clerk instance", () => {
  it("refuses to run at all without OWNER_EMAIL", () => {
    vi.stubEnv("OWNER_EMAIL", "");
    expect(() => guardTestEmail("ascentra-e2e-x@example.com")).toThrow(/OWNER_EMAIL/);
  });

  it("refuses the Owner's email, and anything that isn't a test email", async () => {
    await expect(createTestUser("owner@example.com", { label: "x" })).rejects.toThrow(/Owner/);
    await expect(createTestUser("someone@example.com", { label: "x" })).rejects.toThrow(/isn't a test email/);
    await expect(findTestUser("owner@example.com")).rejects.toThrow(/Owner/);
    expect(clerk.calls).toEqual([]);
  });

  it("never deletes, resets or signs out the Owner, even one carrying a test email and marker", async () => {
    await expect(deleteTestUsers("ascentra-e2e-")).rejects.toThrow(/Owner/);
    await expect(resetTestUser(OWNER as never, "ascentra-e2e-owner-alias@example.com")).rejects.toThrow(/Owner/);
    await expect(signOutTestUser(OWNER.id)).rejects.toThrow(/Owner/);
    expect(clerk.calls.filter((c) => c.includes("user_owner"))).toEqual([]);
  });

  it("does act on a real test user", async () => {
    clerk.users = [TEST];
    expect(await deleteTestUsers("ascentra-e2e-")).toBe(1);
    await signOutTestUser(TEST.id);
    expect(clerk.calls).toEqual(["delete user_e2e", "revoke sess_1"]);
  });

  it("revokes only invitations to test emails", async () => {
    expect(await revokeTestInvitations("ascentra-e2e-")).toBe(1);
    expect(clerk.calls).toEqual(["revoke-invite inv_e2e"]);
  });
});
