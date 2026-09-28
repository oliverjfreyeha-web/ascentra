import type pg from "pg";
import { ROLES, type RoleKey } from "@/lib/caps";
import { createFakeDb } from "../fixtures/fake-db";
import { trustedDeviceRow } from "../fixtures/devices";

/**
 * One signed-in account per role, each on a trusted device, for the Gate 1 suites. The same rows go
 * into the in-memory fake or into a real database (tests/integration/stack.ts).
 */
export const OWNER_EMAIL = "owner@example.com";
export const ROLE_ID: Record<RoleKey, string> = {
  owner: "00000000-0000-4000-8000-000000000001",
  superAdmin: "00000000-0000-4000-8000-000000000002",
  courseAdmin: "00000000-0000-4000-8000-000000000003",
  reviewer: "00000000-0000-4000-8000-000000000004",
  support: "00000000-0000-4000-8000-000000000005",
  guardian: "00000000-0000-4000-8000-000000000006",
  learner: "00000000-0000-4000-8000-000000000007",
};
const DB_ROLE: Partial<Record<RoleKey, string>> = { superAdmin: "super_admin", courseAdmin: "course_admin", reviewer: "reviewer", support: "support" };
export const clerkIdOf = (r: RoleKey) => `user_${r}`;

export function roleRows() {
  const at = "2026-09-01T00:00:00.000Z";
  return {
    accounts: ROLES.map((r) => ({
      id: ROLE_ID[r], clerk_user_id: clerkIdOf(r), email: r === "owner" ? OWNER_EMAIL : `${r.toLowerCase()}@example.com`,
      email_verified: true, role: DB_ROLE[r] ? "admin" : r, status: "active", password_enabled: true, two_factor_enabled: true,
      clerk_updated_at: at,
    })),
    profiles: ROLES.map((r) => ({ account_id: ROLE_ID[r], display_name: `Test ${r}` })),
    role_assignments: (Object.entries(DB_ROLE) as [RoleKey, string][]).map(([r, dbRole]) => ({
      id: `00000000-0000-4000-a000-00000000000${ROLES.indexOf(r)}`, account_id: ROLE_ID[r], role: dbRole,
      scope: r === "courseAdmin" || r === "reviewer" ? ["mkt"] : [], status: "active", assigned_by_account_id: ROLE_ID.owner,
    })),
    trusted_devices: ROLES.map((r) => trustedDeviceRow(ROLE_ID[r])),
  };
}

export const seedFake = () => createFakeDb(roleRows());

/** Inserts the same rows into a real database (as the table owner: this is test setup, not the app). */
export async function seedReal(client: pg.Client) {
  const rows = roleRows();
  for (const [table, list] of Object.entries(rows)) {
    for (const row of list as Record<string, unknown>[]) {
      const r = table === "trusted_devices" ? { ...row, id: undefined } : row;
      const cols = Object.keys(r).filter((k) => r[k] !== undefined);
      const res = await client.query(
        `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
        cols.map((c) => r[c]),
      );
      void res;
    }
  }
}
