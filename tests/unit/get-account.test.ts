import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth }));
const store = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));
vi.mock("@/lib/accounts", () => ({
  findAccountByClerkId: vi.fn(async (id: string) => (store.row?.clerk_user_id === id ? store.row : null)),
  findProfile: vi.fn(async () => ({ account_id: "acc_1", display_name: "Olive Owner", image_url: null })),
}));

import { getAccount } from "@/lib/auth";

const signedIn = { isAuthenticated: true, userId: "user_1", sessionId: "sess_1" };
const signedOut = { isAuthenticated: false, userId: null, sessionId: null };
const goodRow = {
  id: "acc_1",
  clerk_user_id: "user_1",
  email: "owner@example.com",
  email_verified: true,
  role: "owner",
  status: "active",
  password_enabled: true,
  two_factor_enabled: true,
};

beforeEach(() => {
  auth.mockReset();
  store.row = { ...goodRow };
});

describe("getAccount", () => {
  it("returns the Account for a valid session with a verified, active account", async () => {
    auth.mockResolvedValue(signedIn);
    expect(await getAccount()).toEqual({ id: "acc_1", email: "owner@example.com", role: "owner", displayName: "Olive Owner" });
  });

  it("returns nothing with no session (missing, expired and pending sessions all look signed out)", async () => {
    auth.mockResolvedValue(signedOut);
    expect(await getAccount()).toBeNull();
  });

  it("returns nothing when session verification throws", async () => {
    auth.mockRejectedValue(new Error("token expired"));
    expect(await getAccount()).toBeNull();
  });

  it("returns nothing for a Clerk user with no Account (not the Owner, not invited)", async () => {
    auth.mockResolvedValue({ ...signedIn, userId: "user_stranger" });
    expect(await getAccount()).toBeNull();
  });

  it("refuses an unverified email", async () => {
    auth.mockResolvedValue(signedIn);
    store.row = { ...goodRow, email_verified: false };
    expect(await getAccount()).toBeNull();
  });

  it("refuses a password without a second factor", async () => {
    auth.mockResolvedValue(signedIn);
    store.row = { ...goodRow, password_enabled: true, two_factor_enabled: false };
    expect(await getAccount()).toBeNull();
  });

  it("accepts a passkey-only account with no password", async () => {
    auth.mockResolvedValue(signedIn);
    store.row = { ...goodRow, password_enabled: false, two_factor_enabled: false };
    expect(await getAccount()).not.toBeNull();
  });

  it("refuses a disabled account", async () => {
    auth.mockResolvedValue(signedIn);
    store.row = { ...goodRow, status: "disabled" };
    expect(await getAccount()).toBeNull();
  });
});
