"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";

export const ALREADY = (email: string) => `You're already signed in as ${email}.`;

export type GateView = "wait" | "form" | "notice";
/**
 * What the page shows. "wait" until the page has mounted (the server and the first browser render must match), the
 * notice for someone signed in when the page opened, the form for everyone else (including someone who signs in on
 * the page itself: Clerk's own redirect then takes them on).
 */
export function gateView(p: { mounted: boolean; isLoaded: boolean; isSignedIn: boolean; sawSignedOut: boolean }): GateView {
  if (!p.mounted) return "wait";
  return p.isLoaded && p.isSignedIn && !p.sawSignedOut ? "notice" : "form";
}

const noop = () => () => {};

/**
 * R1: opening Create account or Sign in while already signed in used to send the person silently into the account
 * they were signed in to, which looked broken. Now it says so, with a way on and a way out.
 */
export function SignedInGate({ kind, children }: { kind: "create" | "signin"; children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  // Once this page has seen the person signed out, a later sign-in happened here.
  const [sawSignedOut, setSawSignedOut] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remembers that the page opened signed out
    if (isLoaded && !isSignedIn) setSawSignedOut(true);
  }, [isLoaded, isSignedIn]);

  // Decided during render, so Clerk's form never mounts (and never redirects) for someone already signed in.
  const view = gateView({ mounted, isLoaded, isSignedIn: !!isSignedIn, sawSignedOut });
  if (view === "wait") return null;
  if (view === "form") return <>{children}</>;
  return <AlreadySignedIn kind={kind} />;
}

export function AlreadySignedIn({ kind }: { kind: "create" | "signin" }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const email = user?.primaryEmailAddress?.emailAddress ?? "another account";
  return (
    <section aria-labelledby="already-h">
      <h1 id="already-h">{ALREADY(email)}</h1>
      <p className="muted">
        {kind === "create"
          ? "To create a different account, sign out first. Your current account isn't changed."
          : "To sign in with a different account, sign out first."}
      </p>
      <p className="ui-actions">
        <Link href="/account" className="ui-btn ui-btn--primary">Go to my account</Link>{" "}
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void signOut({ redirectUrl: kind === "create" ? "/sign-up" : "/sign-in" }); }}>
          {kind === "create" ? "Sign out to create a different account" : "Sign out to use a different account"}
        </button>
      </p>
    </section>
  );
}
