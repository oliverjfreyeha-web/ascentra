"use client";

import Link from "next/link";
import { adminLinksFor } from "../admin-links";
import { SECOND_FACTOR_HREF, useMe } from "../use-me";
import { Icon, type IconName } from "../ui/design/ds-icon";

/** Design rebuild D6: an icon per admin page, for its tile (decoration only; the list and its rules are unchanged). */
const TILE_ICON: Record<string, IconName> = {
  "/admin/import": "upload", "/admin/review": "check", "/admin/topics": "tag", "/admin/courses": "book", "/admin/sources": "note",
  "/admin/catalog": "grid", "/admin/course-requests": "mail", "/admin/missions": "target", "/admin/audit": "clock",
  "/admin/safety": "shield", "/admin/security": "lock", "/admin/style-guide": "star",
};

/**
 * I1: the admin home's list of the admin pages this account can open (the server still decides every request).
 * Bug fix: reads who is signed in through the shared read (app/use-me.ts) instead of a one-shot fetch that turned any
 * early refusal (a session cookie not yet refreshed, a device not yet trusted) into "No admin pages for this account."
 * A missing second factor is said plainly, with the way to set it up; the rule itself is unchanged.
 */
export function AdminLinks() {
  const state = useMe();
  if (state.status === "loading") return <p className="muted" role="status">Checking your account…</p>;
  if (state.status === "secondFactor") {
    return (
      <p className="notice" role="note">
        Admin needs your second factor. <Link href={SECOND_FACTOR_HREF}>Set up your authenticator to open Admin</Link>.
      </p>
    );
  }
  if (state.status === "signedOut") return <p className="muted"><Link href="/sign-in">Sign in</Link> to open Admin.</p>;
  if (state.status === "refused") return <p className="muted">{state.reason ?? "This account can't open Admin."} <Link href="/welcome">Why?</Link></p>;
  const links = adminLinksFor(state.me.roleKey);
  return (
    <nav aria-label="Admin pages" className="ui-block admin-home">
      <h2>Admin pages</h2>
      {links.length ? (
        <ul className="admin-home__links">{links.map((l) => <li key={l.href}><Link href={l.href}><Icon name={TILE_ICON[l.href] ?? "grid"} size={22} />{l.label}</Link></li>)}</ul>
      ) : <p className="muted">No admin pages for this account.</p>}
    </nav>
  );
}
