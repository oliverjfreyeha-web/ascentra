import "server-only";
import { auth } from "@clerk/nextjs/server";
import { unauthorized } from "@/lib/auth";
import { jsonBody, ok } from "@/lib/http";
import { readEnv } from "@/lib/env";
import type { Result } from "@/lib/registration";

/**
 * The sign-up step runs before an ASCENTRA account exists, so it can't go through withCap (which needs one).
 * It needs a verified Clerk session, and only ever acts on that session's own Clerk user.
 */
export async function clerkUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session.isAuthenticated && session.userId ? session.userId : null;
  } catch (err) {
    console.error("registration: session check failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function ownerEmail(): string | null {
  return readEnv("OWNER_EMAIL") ?? null;
}

export const notConfigured = () => Response.json({ error: "not_configured" }, { status: 500, headers: { "Cache-Control": "no-store" } });

export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  const body = await jsonBody(req);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export const send = (r: Result) =>
  r.ok ? ok(r.body, r.status) : Response.json({ error: r.error, reason: r.reason }, { status: r.status, headers: { "Cache-Control": "no-store" } });

export { unauthorized };
