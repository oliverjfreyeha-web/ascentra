import "server-only";

// Stub until the audit store arrives in F5. Events are written to the server log with a fixed
// prefix so they can be found and backfilled; the Owner cannot see them in the app yet.
export type AuditEvent = {
  type: "account.password_changed" | "account.disabled";
  accountId: string;
  role: "owner" | "admin";
  detail: string;
  at: string;
};

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  console.info("[audit-stub]", JSON.stringify(event));
}
