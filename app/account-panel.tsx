"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ROLE_LABEL } from "@/lib/caps";
import { SignOut } from "./sign-out";
import { meFrom, type Me } from "./me";

// Who is signed in, read only through /api/v1/me. A Clerk session the API refuses goes to /welcome, which says why
// (the sign-up step, a teen waiting for their Guardian, a missing second factor, or no access).
export function AccountPanel() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Right after sign-in, the first answer can be a refusal while this browser's device check is still
    // settling; try a few more times before saying the account couldn't be loaded. The API still decides.
    const load = (attempt: number) =>
      fetch("/api/v1/me", { cache: "no-store" })
        .then(async (res) => {
          if (!live) return;
          if (res.status === 401) router.replace("/welcome");
          else if (res.ok) {
            const account = meFrom(await res.json());
            if (!account) throw new Error("unexpected /api/v1/me answer");
            setMe(account);
          }
          else throw new Error(String(res.status));
        })
        .catch(() => {
          if (!live) return;
          if (attempt < 4) timer = setTimeout(() => void load(attempt + 1), 1000 * (attempt + 1));
          else setFailed(true);
        });
    void load(0);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
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
      {(me?.roleKey === "owner" || me?.roleKey === "superAdmin") && (
        <>
          <Link href="/admin/audit">Audit log</Link> · <Link href="/admin/safety">Safety review</Link> · <Link href="/admin/style-guide">Style guide</Link> ·{" "}
        </>
      )}
      {me && ["owner", "superAdmin", "courseAdmin", "reviewer"].includes(me.roleKey) && (
        <>
          <Link href="/admin/sources">Source library</Link> · <Link href="/admin/courses">Course builder</Link> ·{" "}
        </>
      )}
      {me && ["owner", "courseAdmin", "reviewer"].includes(me.roleKey) && (
        <>
          <Link href="/admin/catalog">Topic catalog</Link> ·{" "}
        </>
      )}
      {me && ["owner", "courseAdmin"].includes(me.roleKey) && (
        <>
          <Link href="/admin/course-requests">Course requests</Link> ·{" "}
        </>
      )}
      {me && me.roleKey !== "guardian" && (
        <>
          <Link href="/learn">Learn</Link> · <Link href="/learn/path">My path</Link> ·{" "}
        </>
      )}
      {(me?.roleKey === "owner" || me?.roleKey === "superAdmin" || me?.roleKey === "support") && (
        <>
          <Link href="/admin/security">Account safeguards</Link> ·{" "}
        </>
      )}
      {me?.roleKey === "guardian" && (
        <>
          <Link href="/guardian">Guardian Center</Link> ·{" "}
        </>
      )}
      <Link href="/account">Account and devices</Link> · <SignOut />
    </p>
  );
}
