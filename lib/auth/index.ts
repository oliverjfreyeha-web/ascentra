import "server-only";
import { auth } from "@clerk/nextjs/server";
import { findAccountByClerkId, findProfile, type AccountRow, type Role } from "@/lib/accounts";

export type Account = {
  id: string;
  email: string;
  role: Role;
  displayName: string;
};

/**
 * Why a row is not usable, or null when it is. A password must always be paired with a
 * second factor; passkey-only accounts need none (the passkey is the strong factor).
 */
export function accountRefusal(row: AccountRow): string | null {
  if (row.status !== "active") return "disabled";
  if (!row.email_verified) return "email_unverified";
  if (row.password_enabled && !row.two_factor_enabled) return "second_factor_missing";
  return null;
}

/**
 * The server's single way to turn a request into an Account.
 * Returns null for a missing, expired, pending or invalid session, an unverified email,
 * or a Clerk user with no Account (not the Owner and not invited).
 */
export async function getAccount(): Promise<Account | null> {
  let session;
  try {
    session = await auth();
  } catch (err) {
    // A thrown auth() is a misconfiguration (e.g. the proxy not running), not a signed-out user: log it.
    console.error("getAccount: session check failed:", err instanceof Error ? err.message : err);
    return null;
  }
  // auth() verifies the session token (signature and expiry) and treats pending sessions as signed out.
  if (!session.isAuthenticated || !session.userId) return null;

  const row = await findAccountByClerkId(session.userId);
  if (!row || accountRefusal(row)) return null;
  const profile = await findProfile(row.id);
  return { id: row.id, email: row.email, role: row.role, displayName: profile?.display_name ?? row.email };
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

/** Wraps an /api/v1 handler: no Account, no handler. Every /api/v1 route except /health uses this. */
export function withAccount<Ctx>(handler: (req: Request, ctx: Ctx, account: Account) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const account = await getAccount();
    if (!account) return unauthorized();
    return handler(req, ctx, account);
  };
}
