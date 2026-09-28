import "server-only";

// Stub until the audit store arrives in F5. Events are written to the server log with a fixed
// prefix so they can be found and backfilled; the Owner cannot see them in the app yet.
export type AuditEvent = {
  type:
    | "account.password_changed"
    | "account.disabled"
    | "capability.refused"
    | "admin.invited"
    | "admin.invite_revoked"
    | "admin.invite_refused"
    | "admin.invite_claimed"
    | "admin.activated"
    | "admin.role_changed"
    | "admin.removed"
    | "owner.protected";
  /** Who acted; null for the system (e.g. a webhook). */
  actorAccountId: string | null;
  /** The account acted on, when there is one. */
  targetAccountId?: string | null;
  detail: string;
  at?: string;
};

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  console.info("[audit-stub]", JSON.stringify({ at: new Date().toISOString(), ...event }));
}
