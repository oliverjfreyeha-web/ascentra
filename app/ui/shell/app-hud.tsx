"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StaffNav } from "../../staff-nav";
import { useMe } from "../../use-me";
import { Icon, type IconName } from "../design/ds-icon";

/** Pages that carry the app shell. Visitor and sign-in screens keep their own simple layouts. */
const SHELL_PATHS = ["/learn", "/account", "/admin", "/guardian", "/community", "/pro", "/dev"];
export const hasShell = (path: string) => path === "/" || SHELL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

type Tab = { href: string; label: string; icon: IconName };
/**
 * The tabs for a signed-in role. The same links Home's account line (app/account-panel.tsx) already gives each role:
 * Learn, My path and Progress for everyone who learns (not Guardians); the Guardian Center for Guardians. The Admin link
 * stays the staff navigation (app/staff-nav.tsx), unchanged. The server still decides every request; these are links.
 */
export function tabsFor(role: string | null): Tab[] {
  if (!role) return [];
  const tabs: Tab[] = [{ href: "/", label: "Home", icon: "home" }];
  if (role === "guardian") tabs.push({ href: "/guardian", label: "Guardian Center", icon: "shield" });
  else tabs.push({ href: "/learn", label: "Learn", icon: "book" }, { href: "/learn/path", label: "My path", icon: "map" }, { href: "/learn/progress", label: "Progress", icon: "chart" });
  return tabs;
}
/** The tab for this page: the longest matching link ("/" only on Home). */
export function activeTab(tabs: Tab[], path: string): string | null {
  const hits = tabs.filter((t) => (t.href === "/" ? path === "/" : path === t.href || path.startsWith(`${t.href}/`)));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** A placeholder emblem until the real logo arrives: a faceted "A" peak in the icon set's gradients. */
function Emblem() {
  return (
    <svg className="app-hud__emblem" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 2.5 28.5 9.5v13L16 29.5 3.5 22.5v-13z" fill="url(#asc-ic-fill)" stroke="url(#asc-ic-line)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10 21.5 16 9l6 12.5M12.6 16.6h6.8" fill="none" stroke="url(#asc-ic-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Design rebuild D3 · The app shell's navigation HUD (sticky, etched glass, no textures): emblem and ASCENTRA wordmark,
 * the role's tabs with icons, the staff navigation (Admin, Owner and staff only, as before), and Account and
 * Appearance icon buttons. No role switch: the real app has none. On the landing it shows only once the visitor is
 * signed in (Home); the Hall has its own navigation. On pages without the shell, the staff navigation stays as it was.
 * The frame renders at once (its height never changes), and the tabs fill in when the account is known: no layout shift.
 */
export function AppHud() {
  const path = usePathname() ?? "/";
  const state = useMe();
  if (!hasShell(path)) return <StaffNav />;
  const tabs = tabsFor(state.status === "ready" ? state.me.roleKey : null);
  const active = activeTab(tabs, path);
  return (
    <header className="app-hud ds-glass ds-glass--hud" data-landing-home={path === "/" ? "" : undefined}>
      <Link href="/" className="app-hud__brand" aria-label="ASCENTRA home">
        <Emblem />
        <span className="ds-display app-hud__word">ASCENTRA</span>
      </Link>
      <nav className="app-hud__tabs" aria-label="Primary">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="app-hud__tab" aria-current={active === t.href ? "page" : undefined} data-sfx="nav">
            <Icon name={t.icon} size={18} />
            <span className="app-hud__label">{t.label}</span>
          </Link>
        ))}
      </nav>
      <StaffNav />
      <div className="app-hud__actions">
        <Link href="/account" className="ds-btn ds-btn--icon ds-btn--sm ds-glass" aria-label="Account" data-sfx="open"><Icon name="user" size={16} /></Link>
        <Link href="/account#appearance" className="ds-btn ds-btn--icon ds-btn--sm ds-glass" aria-label="Appearance settings" data-sfx="open"><Icon name="gear" size={16} /></Link>
      </div>
    </header>
  );
}
