"use client";

import Link from "next/link";
import { useMe } from "../use-me";

/**
 * Account's breadcrumb links to Learn and My progress, for everyone who learns (not Guardians, who don't).
 * Shown once the account is known, so a Guardian never sees them flash in. The server still decides every page.
 */
export function LearnCrumbs() {
  const state = useMe();
  if (state.status !== "ready" || state.me.roleKey === "guardian") return null;
  return (
    <>
      <Link href="/learn">Learn</Link> · <Link href="/learn/progress">My progress</Link> ·{" "}
    </>
  );
}
