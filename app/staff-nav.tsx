"use client";

import Link from "next/link";
import { isStaff } from "./admin-links";
import { useMe } from "./use-me";

/**
 * S1: the one Admin link, on every signed-in page (rendered by the root layout), for the Owner and staff only; never for
 * learners or Guardians. Who is signed in comes from the shared read (app/use-me.ts: waits for Clerk, refreshes the
 * session token, runs the device check, retries), not a one-shot fetch that a race could leave empty for good.
 * The admin pages and the API still decide every request; this is only a link.
 */
export function StaffNav() {
  const state = useMe();
  if (state.status !== "ready" || !isStaff(state.me.roleKey)) return null;
  return (
    <nav className="staff-nav" aria-label="Staff">
      <Link href="/admin">Admin</Link>
    </nav>
  );
}
