"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";

/** The wording, shared with the tests. */
export const PROTECT_TIP = "Add extra protection with an authenticator app (recommended).";
const KEY = { account: "ascentra.protectTip.account", home: "ascentra.protectTip.home" } as const;

const read = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* private window: it just shows again */ } };

/**
 * R1: a learner's second factor is optional. This suggests one, calmly: on the Account page until dismissed, and on the
 * learner home only once. It never blocks anything, and it doesn't show to anyone who already has one. (Owner, admin
 * and Guardian accounts can't get this far without one.) The dismissal is kept in this browser only.
 */
export function ProtectTip({ where }: { where: "account" | "home" }) {
  const { isLoaded, user } = useUser();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isLoaded || !user || user.twoFactorEnabled) return;
    if (read(KEY[where])) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this browser's dismissal after hydration
    setShow(true);
    // The home shows it once: the next visit doesn't.
    if (where === "home") write(KEY.home, "seen");
  }, [isLoaded, user, where]);
  if (!show) return null;
  return (
    <aside className="ui-banner" aria-label="Optional: extra protection">
      <span className="ui-banner__mark" aria-hidden="true" />
      <span>
        {PROTECT_TIP}{" "}
        {where === "home" ? <Link href="/account#sign-in-methods">Add one</Link> : <a href="#sign-in-methods">Add one below</a>}
        {" · "}
        <button type="button" className="link" onClick={() => { write(KEY[where], "dismissed"); setShow(false); }}>Not now</button>
      </span>
    </aside>
  );
}
