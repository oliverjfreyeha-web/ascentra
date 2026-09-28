"use client";

import { useClerk } from "@clerk/nextjs";

/** Ends this device's session first (so a paused device can continue), then signs out with Clerk. */
export function SignOut({ label = "Sign out" }: { label?: string }) {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      className="link"
      onClick={async () => {
        await fetch("/api/v1/session/end", { method: "POST", cache: "no-store" }).catch(() => undefined);
        await signOut({ redirectUrl: "/" });
      }}
    >
      {label}
    </button>
  );
}
