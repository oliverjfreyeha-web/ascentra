import type { RoleKey } from "@/lib/caps";

/** What GET /api/v1/me answers: the signed-in account, nested under `account`. */
export type Me = { id: string; email: string; role: string; roleKey: RoleKey; displayName: string; assignedCourses: string[] };

/** Reads the account out of a /api/v1/me response body. Every page that asks who is signed in goes through this. */
export function meFrom(body: unknown): Me | null {
  const account = (body as { account?: Partial<Me> } | null)?.account;
  return account && typeof account.roleKey === "string" ? (account as Me) : null;
}
