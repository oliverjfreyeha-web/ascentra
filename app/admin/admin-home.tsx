"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { meFrom } from "../me";
import { adminLinksFor } from "../admin-links";
import type { RoleKey } from "@/lib/caps";

/** I1: the admin home's list of the admin pages this account can open (the server still decides every request). */
export function AdminLinks() {
  const [role, setRole] = useState<RoleKey | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
  }, []);
  if (role === undefined) return null;
  const links = adminLinksFor(role);
  return (
    <nav aria-label="Admin pages" className="ui-block admin-home">
      <h2>Admin pages</h2>
      {links.length ? (
        <ul className="admin-home__links">{links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
      ) : <p className="muted">No admin pages for this account.</p>}
    </nav>
  );
}
