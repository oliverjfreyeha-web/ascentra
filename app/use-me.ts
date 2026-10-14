"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { call } from "./call";
import { meFrom, type Me } from "./me";

/**
 * Who is signed in, for the pages' navigation (the Admin link, the admin home's list, the account line, the home page).
 * Read only through GET /api/v1/me; the server decides every request, this only decides what to show.
 *
 * Bug fix: each of those pages used to ask once, as soon as it mounted, with a bare fetch: before Clerk had loaded and
 * refreshed its short-lived session cookie, and without the trusted-device check that app/call.ts runs. The first answer
 * could be a 401 or "device not trusted" for a signed-in Owner, and the page then showed that as final (no Admin link,
 * "No admin pages for this account.", "Sign in to continue."). Now it:
 *   - waits for Clerk to load, and asks Clerk for a fresh session token first (which refreshes the session cookie);
 *   - uses call(), which runs the device check once and retries when the browser wasn't trusted yet;
 *   - retries a 401 a few times while Clerk says signed in, then asks /api/registration why: a missing second factor
 *     is shown truthfully (Owner, admins and Guardians must have one; that rule is unchanged).
 */
export type MeState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "ready"; me: Me }
  /** Signed in with Clerk, but the account needs its second factor (authenticator) before anything opens. */
  | { status: "secondFactor" }
  /** Signed in with Clerk, but the server refuses the account (the welcome page says why). */
  | { status: "refused"; reason: string | null };

const RETRIES = 3;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loadMe(signedIn: boolean, freshToken: (force: boolean) => Promise<unknown>, pause: (ms: number) => Promise<unknown> = wait): Promise<MeState> {
  for (let attempt = 0; ; attempt++) {
    // A valid token is reused; an expired one (or any retry) is fetched anew, which also refreshes the session cookie.
    if (signedIn) await freshToken(attempt > 0).catch(() => undefined);
    const r = await call("GET", "/api/v1/me").catch(() => null);
    const me = r && r._status === 200 ? meFrom(r) : null;
    if (me) return { status: "ready", me };
    // Clerk says signed out and the server agrees: a visitor.
    if (!signedIn) return { status: "signedOut" };
    if (r && r._status === 401) {
      if (attempt < RETRIES) { await pause(500 * (attempt + 1)); continue; }
      const why = await call("GET", "/api/registration").catch(() => null);
      if (why && why.state === "second_factor") return { status: "secondFactor" };
      return { status: "refused", reason: null };
    }
    if (!r && attempt < RETRIES) { await pause(500 * (attempt + 1)); continue; }
    return { status: "refused", reason: r?.reason ?? null };
  }
}

// The navigation, the account line and the page itself all ask at once: share one answer for a few seconds.
let last: { signedIn: boolean; at: number; p: Promise<MeState> } | null = null;
function shared(signedIn: boolean, run: () => Promise<MeState>): Promise<MeState> {
  const now = Date.now();
  if (last && last.signedIn === signedIn && now - last.at < 5000) return last.p;
  last = { signedIn, at: now, p: run() };
  return last.p;
}

export function useMe(): MeState {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<MeState>({ status: "loading" });
  useEffect(() => {
    if (!isLoaded) return;
    let live = true;
    void shared(!!isSignedIn, () => loadMe(!!isSignedIn, (force) => (getToken ? getToken(force ? { skipCache: true } : undefined) : Promise.resolve(null))))
      .then((s) => live && setState(s));
    return () => { live = false; };
  }, [isLoaded, isSignedIn, getToken]);
  return state;
}

/** Where the Owner, an admin or a Guardian sets up the authenticator (Clerk's Security section on the Account page). */
export const SECOND_FACTOR_HREF = "/account#sign-in-methods";
