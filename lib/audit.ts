import "server-only";
import { getDb } from "@/lib/db";

/**
 * The audit store. recordAudit() is the only code that writes an audit_events row; the database
 * makes the table insert-only and chains every row to the previous one (0006).
 *
 * Fields follow the prototype's audit() (reference/ascentra.html): actor with role, time, action,
 * context, target, previous value, new value, reason, result (Completed | Blocked) and status
 * (Recorded | No change made), plus the request id and the trusted device the request came from (F6;
 * null for system events and requests from a device that isn't trusted).
 */

/** The prototype's SENSITIVE_RX: events matching it are flagged Sensitive. */
export const SENSITIVE_RX =
  /role|admin|invit|owner|consent|appeal|restriction|privacy|deletion|export|safety|publish|restor|archiv|price|entitlement|exception|blocked|claim|workflow status|scope/i;

export type AuditActor = { accountId: string | null; label: string; role: string | null };
export const SYSTEM_ACTOR = (what: string): AuditActor => ({ accountId: null, label: `System (${what})`, role: null });

export type AuditResult = "Completed" | "Blocked";

export type AuditInput = {
  actor: AuditActor;
  /** Machine-searchable: the capability or event name, e.g. "admins.invite", "account.password_changed". */
  action: string;
  /** One plain sentence: what happened, or why it was refused. */
  context: string;
  target?: { type: string; id: string; label?: string | null } | null;
  previous?: string | null;
  next?: string | null;
  reason?: string | null;
  result: AuditResult;
  /** Defaults: "Recorded" when Completed, "No change made" when Blocked. */
  status?: string;
  requestId?: string | null;
  deviceId?: string | null;
  sensitive?: boolean;
};

export async function recordAudit(e: AuditInput): Promise<void> {
  const row = {
    actor_account_id: e.actor.accountId,
    actor_label: e.actor.label,
    actor_role: e.actor.role,
    action: e.action,
    context: e.context,
    target_type: e.target?.type ?? null,
    target_id: e.target?.id ?? null,
    target_label: e.target?.label ?? null,
    previous_value: e.previous ?? null,
    new_value: e.next ?? null,
    reason: e.reason ?? null,
    result: e.result === "Blocked" ? "blocked" : "completed",
    status: e.status ?? (e.result === "Blocked" ? "No change made" : "Recorded"),
    is_sensitive: e.sensitive ?? SENSITIVE_RX.test(`${e.action} ${e.context}`),
    request_id: e.requestId ?? null,
    device_id: e.deviceId ?? null,
  };
  const { error } = await getDb().from("audit_events").insert(row);
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

// ============ Reading (Owner and Super Admin, checked by the routes) ============

export type AuditEvent = {
  seq: number;
  at: string;
  actor: string;
  actorRole: string | null;
  action: string;
  context: string | null;
  target: string | null;
  previous: string | null;
  next: string | null;
  reason: string | null;
  result: AuditResult;
  status: string;
  sensitive: boolean;
  requestId: string | null;
  deviceId: string | null;
  hash: string;
};

type Row = Record<string, unknown>;
const toEvent = (r: Row): AuditEvent => ({
  seq: Number(r.seq),
  at: String(r.occurred_at),
  actor: String(r.actor_label),
  actorRole: (r.actor_role as string) ?? null,
  action: String(r.action),
  context: (r.context as string) ?? null,
  target: (r.target_label as string) ?? (r.target_id ? `${r.target_type}:${r.target_id}` : null),
  previous: (r.previous_value as string) ?? null,
  next: (r.new_value as string) ?? null,
  reason: (r.reason as string) ?? null,
  result: r.result === "blocked" ? "Blocked" : "Completed",
  status: String(r.status),
  sensitive: Boolean(r.is_sensitive),
  requestId: (r.request_id as string) ?? null,
  deviceId: (r.device_id as string) ?? null,
  hash: String(r.row_hash),
});

export type AuditFilters = { actor?: string; action?: string; target?: string; from?: string; to?: string; before?: number };

/** Characters that mean something to ilike or to PostgREST's or() syntax are removed from search text. */
const clean = (s: string) => s.replace(/[%_\\,()*"]/g, " ").trim().slice(0, 100);

export async function searchAudit(f: AuditFilters, limit = 100): Promise<AuditEvent[]> {
  let q = getDb().from("audit_events").select("*").order("seq", { ascending: false }).limit(limit);
  if (f.actor && clean(f.actor)) q = q.ilike("actor_label", `%${clean(f.actor)}%`);
  if (f.action && clean(f.action)) q = q.ilike("action", `%${clean(f.action)}%`);
  if (f.target && clean(f.target)) {
    const t = clean(f.target);
    q = q.or(`target_label.ilike.%${t}%,target_id.ilike.%${t}%`);
  }
  if (f.from) q = q.gte("occurred_at", f.from);
  if (f.to) q = q.lte("occurred_at", f.to);
  if (f.before) q = q.lt("seq", f.before);
  const { data, error } = await q;
  if (error) throw new Error(`audit search failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toEvent);
}

const CSV_COLUMNS: (keyof AuditEvent)[] = [
  "seq", "at", "actor", "actorRole", "action", "context", "target", "previous", "next", "reason", "result", "status",
  "sensitive", "requestId", "deviceId", "hash",
];
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
export function toCsv(events: AuditEvent[]): string {
  return [CSV_COLUMNS.join(","), ...events.map((e) => CSV_COLUMNS.map((c) => csvCell(e[c])).join(","))].join("\r\n") + "\r\n";
}

// ============ Tamper evidence ============

export type ChainReport = {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  problem: string | null;
  headSeq: number | null;
  headHash: string | null;
};

/** Walks the whole chain in the database (public.audit_verify_chain) and reports the first break. */
export async function verifyAuditChain(): Promise<ChainReport> {
  const { data, error } = await getDb().rpc("audit_verify_chain");
  if (error) throw new Error(`audit verification failed: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Row;
  return {
    ok: Boolean(r.ok),
    checked: Number(r.checked),
    brokenAtSeq: r.broken_at_seq == null ? null : Number(r.broken_at_seq),
    problem: (r.problem as string) ?? null,
    headSeq: r.head_seq == null ? null : Number(r.head_seq),
    headHash: (r.head_hash as string) ?? null,
  };
}
