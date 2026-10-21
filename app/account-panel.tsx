"use client";

import { Fragment, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ROLE_LABEL } from "@/lib/caps";
import { adminLinksFor } from "./admin-links";
import { SignOut } from "./sign-out";
import type { Me } from "./me";
import { useMe } from "./use-me";
import { useOnboardingGuard } from "./onboarding";
import { ProtectTip } from "./ui/protect-tip";

// Who is signed in, read only through /api/v1/me. A Clerk session the API refuses goes to /welcome, which says why
// (the sign-up step, a teen waiting for their Guardian, a missing second factor, or no access).
export function AccountPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  // Bug fix: one shared read (app/use-me.ts) that waits for Clerk, refreshes the session token and retries, instead of
  // a bare fetch whose first 401 sent a signed-in Owner to /welcome.
  const state = useMe();
  const me: Me | null = state.status === "ready" ? state.me : null;
  const failed = state.status === "refused" || state.status === "secondFactor";
  useOnboardingGuard();

  useEffect(() => {
    // A Clerk session the API still refuses after the retries goes to /welcome, which says why.
    if (isSignedIn && failed) router.replace("/welcome");
  }, [isSignedIn, failed, router]);

  if (!isLoaded) return null;
  // The server is the authority: someone it knows is signed in sees their line even if Clerk's browser state lags.
  if (!isSignedIn && !me) {
    return (
      <p>
        <Link href="/sign-in" className="ui-btn ui-btn--primary">Sign in</Link>
      </p>
    );
  }
  return (
    <>
    <p className="muted">
      {me ? `Signed in as ${me.displayName} (${ROLE_LABEL[me.roleKey]}) · ` : failed ? "Couldn't load your account. " : "Checking your account… "}
      {/* S1: the one Admin link (Owner and staff only) is the staff navigation on every signed-in page (app/staff-nav.tsx).
          These are the same per-role pages the admin home lists (app/admin-links.ts), so the two can't drift. */}
      {me && adminLinksFor(me.roleKey).map((l) => (
        <Fragment key={l.href}>
          <Link href={l.href}>{l.label}</Link> ·{" "}
        </Fragment>
      ))}
      {me && me.roleKey !== "guardian" && (
        <>
          <Link href="/learn">Learn</Link> · <Link href="/learn/path">My path</Link> · <Link href="/learn/choose">Choose your path</Link> · <Link href="/learn/progress">Progress</Link> ·{" "}
        </>
      )}
      {me?.roleKey === "guardian" && (
        <>
          <Link href="/guardian">Guardian Center</Link> ·{" "}
        </>
      )}
      <Link href="/account">Account and devices</Link> · <SignOut />
    </p>
    {/* R1: a learner's second factor is optional; suggested once here, never required. */}
    {me?.roleKey === "learner" && <ProtectTip where="home" />}
    </>
  );
}
