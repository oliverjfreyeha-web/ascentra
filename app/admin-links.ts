/**
 * The admin pages each role can open (the server still decides every request; this only lists links). Used by the
 * admin home (/admin) and the main navigation's "Admin" link (I1). Tested in tests/unit/admin-links.test.ts.
 */
import type { RoleKey } from "@/lib/caps";

export type AdminLink = { href: string; label: string; roles: readonly RoleKey[] };
export const ADMIN_LINKS: readonly AdminLink[] = [
  { href: "/admin/import", label: "Import course", roles: ["owner"] },
  { href: "/admin/review", label: "Owner review", roles: ["owner"] },
  { href: "/admin/topics", label: "Topics", roles: ["owner", "superAdmin", "courseAdmin"] },
  { href: "/admin/courses", label: "Course builder", roles: ["owner", "superAdmin", "courseAdmin", "reviewer"] },
  { href: "/admin/sources", label: "Source library", roles: ["owner", "superAdmin", "courseAdmin", "reviewer"] },
  { href: "/admin/catalog", label: "Topic catalog", roles: ["owner", "courseAdmin", "reviewer"] },
  { href: "/admin/course-requests", label: "Course requests", roles: ["owner", "courseAdmin"] },
  { href: "/admin/missions", label: "Missions and leaderboard", roles: ["owner"] },
  { href: "/admin/audit", label: "Audit log", roles: ["owner", "superAdmin"] },
  { href: "/admin/safety", label: "Safety review", roles: ["owner", "superAdmin"] },
  { href: "/admin/security", label: "Account safeguards", roles: ["owner", "superAdmin", "support"] },
  { href: "/admin/style-guide", label: "Style guide", roles: ["owner", "superAdmin"] },
];
/** Owner and staff see the Admin link; learners and Guardians don't. */
export const STAFF_ROLES: readonly RoleKey[] = ["owner", "superAdmin", "courseAdmin", "reviewer", "support"];
export const isStaff = (role: RoleKey | null | undefined) => !!role && STAFF_ROLES.includes(role);
export const adminLinksFor = (role: RoleKey | null | undefined) => (role ? ADMIN_LINKS.filter((l) => l.roles.includes(role)) : []);
