import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import { CATEGORY_LABEL, type SafetyCategory } from "./rules";

/**
 * L4: the safety review queue (the Owner and Super Admins). Open events first, a teen's urgent ones at the front. It
 * shows who, when, the category, where the check fired and what was done: never what was written (Mentor threads are
 * private to the learner).
 */
type Row = {
  id: string; subject_account_id: string; category: SafetyCategory; reason: string; actions_taken: string[]; severity: string; stage: string | null;
  is_minor: boolean; priority: number; guardian_policy: string | null; status: string; review_note: string | null; acknowledged_at: string | null; created_at: string;
};

export async function safetyQueue(status: string | null) {
  const db = getDb();
  let q = db.from("safety_events").select("*");
  if (status === "open" || status === "reviewed") q = q.eq("status", status);
  const rows = ((await q.order("created_at", { ascending: false }).limit(200)).data ?? []) as Row[];
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || a.priority - b.priority || b.created_at.localeCompare(a.created_at));
  const ids = [...new Set(rows.map((r) => r.subject_account_id))];
  const people = ids.length ? (((await db.from("profiles").select("account_id, display_name").in("account_id", ids)).data ?? []) as { account_id: string; display_name: string | null }[]) : [];
  const emails = ids.length ? (((await db.from("accounts").select("id, email").in("id", ids)).data ?? []) as { id: string; email: string }[]) : [];
  return rows.map((r) => ({
    id: r.id, category: r.category, categoryLabel: CATEGORY_LABEL[r.category] ?? r.category, severity: r.severity, priority: r.priority, stage: r.stage,
    teen: r.is_minor, actions: r.actions_taken, guardianPolicy: r.guardian_policy, status: r.status, reviewNote: r.review_note, reviewedAt: r.acknowledged_at, createdAt: r.created_at,
    subject: { id: r.subject_account_id, name: people.find((p) => p.account_id === r.subject_account_id)?.display_name ?? null, email: emails.find((e) => e.id === r.subject_account_id)?.email ?? null },
  }));
}

/** Marks an event reviewed; the request's reason is the review note. */
export async function reviewSafetyEvent(actor: Account, id: string, note: string): Promise<Result> {
  const A = "safety.review";
  if (!isUuid(id)) return refused(404, "No such safety event.", A);
  const db = getDb();
  const ev = (await db.from("safety_events").select("id, status, category, is_minor").eq("id", id).maybeSingle()).data as { id: string; status: string; category: SafetyCategory; is_minor: boolean } | null;
  if (!ev) return refused(404, "No such safety event.", A);
  const target = { type: "safety_event", id, label: CATEGORY_LABEL[ev.category] };
  if (ev.status === "reviewed") return refused(409, "This event was already reviewed.", A, target);
  const { error } = await db.from("safety_events").update({ status: "reviewed", acknowledged_by_account_id: actor.id, acknowledged_at: new Date().toISOString(), review_note: note.slice(0, 1000) }).eq("id", id);
  if (error) throw new Error(`safety review failed: ${error.message}`);
  return {
    ok: true, body: { id, status: "reviewed" },
    event: { action: A, result: "Completed", target, previous: "open", next: "reviewed", sensitive: true, context: `Reviewed a ${ev.is_minor ? "teen's " : ""}${CATEGORY_LABEL[ev.category]} safety event.` },
  };
}
