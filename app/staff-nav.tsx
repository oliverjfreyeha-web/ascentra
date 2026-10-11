"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { meFrom } from "./me";
import { isStaff } from "./admin-links";

/**
 * S1: the one Admin link, on every signed-in page (rendered by the root layout), for the Owner and staff only; never for
 * learners or Guardians. Who is signed in is read only through /api/v1/me; any refusal or error shows nothing. The admin
 * pages and the API still decide every request; this is only a link.
 */
export function StaffNav() {
  const { isSignedIn } = useAuth();
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    fetch("/api/v1/me", { cache: "no-store" })
      .then(async (r) => (r.ok ? meFrom(await r.json()) : null))
      .then((me) => live && setStaff(isStaff(me?.roleKey)))
      .catch(() => undefined);
    return () => { live = false; };
  }, [isSignedIn]);
  if (!isSignedIn || !staff) return null;
  return (
    <nav className="staff-nav" aria-label="Staff">
      <Link href="/admin">Admin</Link>
    </nav>
  );
}
