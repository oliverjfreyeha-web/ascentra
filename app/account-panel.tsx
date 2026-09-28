"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignOutButton, useAuth } from "@clerk/nextjs";
import { ROLE_LABEL, type RoleKey } from "@/lib/caps";

type Me = { email: string; roleKey: RoleKey; displayName: string };

// Who is signed in, read only through /api/v1/me. A Clerk session without an Account goes to /not-open.
export function AccountPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    fetch("/api/v1/me", { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 401) router.replace("/not-open");
        else if (res.ok) setMe(((await res.json()) as { account: Me }).account);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [isSignedIn, router]);

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <p>
        <Link href="/sign-in">Sign in</Link>
      </p>
    );
  }
  return (
    <p className="muted">
      {me ? `Signed in as ${me.displayName} (${ROLE_LABEL[me.roleKey]}) · ` : failed ? "Couldn't load your account. " : "Checking your account… "}
      {me?.roleKey === "owner" && (
        <>
          <Link href="/admin">Administrators</Link> ·{" "}
        </>
      )}
      <Link href="/account">Account security</Link> ·{" "}
      <SignOutButton>
        <button type="button" className="link">
          Sign out
        </button>
      </SignOutButton>
    </p>
  );
}
