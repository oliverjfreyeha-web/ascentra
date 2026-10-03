import "server-only";
import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import type { AuditInput } from "@/lib/audit";
import type { Account } from "@/lib/auth";
import { LIVE_STATUSES, type SubscriptionRow } from "@/lib/billing";
import { RENEWAL_TERMS_KEY } from "@/lib/billing-terms";
import { openLinkOfTeen } from "@/lib/guardians";
import { PRIVACY_TIMINGS } from "@/lib/notice-config";

/**
 * B4: the Privacy Center. What I agreed to (each document and version), withdrawing optional consent, downloading
 * my data, and requesting deletion. Every request is a privacy_requests row with a due date, and audited.
 * A teen's export and deletion are handled by their Guardian (Minor Privacy Notice).
 */
type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type PrivacyResult<T = Record<string, unknown>> =
  | { ok: true; status?: number; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
const refused = (status: number, reason: string, action: string, target: Event["target"] = null): PrivacyResult<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEEN_HANDLED = "Your Guardian handles export and deletion for your account.";

type ConsentRow = {
  id: string; account_id: string; actor_account_id: string; relation: string; legal_document_version_id: string;
  status: "given" | "withdrawn"; method: string; consented_at: string; created_at: string;
};

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return (data ?? []) as T[];
}

/** Whose data this account may act on: itself, or a teen it is the Guardian of record for. */
async function subjectFor(account: Account, forAccountId: unknown): Promise<string | null> {
  if (forAccountId == null || forAccountId === account.id) return account.id;
  if (account.roleKey !== "guardian" || typeof forAccountId !== "string" || !UUID.test(forAccountId)) return null;
  const link = await openLinkOfTeen(forAccountId);
  return link?.guardian_account_id === account.id ? forAccountId : null;
}

async function liveSubscription(payerId: string, beneficiaryId: string): Promise<SubscriptionRow | null> {
  const subs = await rows<SubscriptionRow>(getDb().from("subscriptions").select("*").eq("payer_account_id", payerId)
    .eq("beneficiary_account_id", beneficiaryId).order("created_at", { ascending: false }).limit(1), "subscription lookup");
  const s = subs[0];
  return s && LIVE_STATUSES.includes(s.status) && !s.cancel_at_period_end ? s : null;
}

export async function privacyOverview(account: Account) {
  const db = getDb();
  const mine = await rows<ConsentRow>(db.from("consent_records").select("*").eq("account_id", account.id).order("created_at", { ascending: true }), "consents");
  const byMe = await rows<ConsentRow>(db.from("consent_records").select("*").eq("actor_account_id", account.id).order("created_at", { ascending: true }), "consents");
  const all = [...new Map([...mine, ...byMe].map((c) => [c.id, c])).values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const docIds = [...new Set(all.map((c) => c.legal_document_version_id))];
  const docs = docIds.length
    ? await rows<{ id: string; document_key: string; title: string; version: string }>(db.from("legal_document_versions").select("id, document_key, title, version").in("id", docIds), "documents")
    : [];
  const doc = new Map(docs.map((d) => [d.id, d]));
  const names = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (id === account.id) return "You";
    if (!names.has(id)) {
      const p = (await db.from("profiles").select("display_name").eq("account_id", id).maybeSingle()).data as { display_name: string } | null;
      names.set(id, p?.display_name.split(/\s+/)[0] ?? "Your teen");
    }
    return names.get(id)!;
  };
  // The latest row per (whose, who agreed, document) is the current state; earlier rows stay as history.
  const latest = new Map<string, ConsentRow>();
  for (const c of all) latest.set(`${c.account_id}|${c.actor_account_id}|${c.legal_document_version_id}`, c);
  const consents = [];
  for (const c of all) {
    const d = doc.get(c.legal_document_version_id);
    const current = latest.get(`${c.account_id}|${c.actor_account_id}|${c.legal_document_version_id}`)!.id === c.id;
    const renewal = d?.document_key === RENEWAL_TERMS_KEY;
    const teenDoc = c.relation === "guardian_for_teen" && !renewal;
    consents.push({
      id: c.id, title: d?.title ?? "Document", version: d?.version ?? "", status: c.status, at: c.consented_at, method: c.method,
      for: await nameOf(c.account_id), by: await nameOf(c.actor_account_id), current,
      // Optional consents: recurring billing (withdrawing cancels the plan at the period end) and, for a Guardian,
      // consent for a teen (withdrawn in the Guardian Center, with a reason). Terms and privacy can't be withdrawn alone.
      withdraw: current && c.status === "given" && c.actor_account_id === account.id ? (renewal ? "here" : teenDoc ? "guardian_center" : null) : null,
    });
  }
  const requests = await rows<{ id: string; account_id: string; kind: string; status: string; due_at: string; completed_at: string | null; created_at: string }>(
    db.from("privacy_requests").select("id, account_id, kind, status, due_at, completed_at, created_at").eq("requested_by_account_id", account.id)
      .order("created_at", { ascending: false }), "privacy requests");
  const teens = account.roleKey === "guardian"
    ? await rows<{ teen_account_id: string }>(db.from("guardian_relationships").select("teen_account_id").eq("guardian_account_id", account.id)
      .is("withdrawn_at", null).in("verification_status", ["pending", "verified"]), "guardian links")
    : [];
  return {
    consents,
    requests: await Promise.all(requests.map(async (r) => ({ ...r, for: await nameOf(r.account_id) }))),
    subjects: [{ id: account.id, name: "You" }, ...(await Promise.all(teens.map(async (t) => ({ id: t.teen_account_id, name: await nameOf(t.teen_account_id) }))))],
    teenHandledByGuardian: account.isMinor,
    canRequestDeletion: account.roleKey !== "owner" && !account.isMinor,
    dueDays: { export: PRIVACY_TIMINGS.exportDueDays, deletion: PRIVACY_TIMINGS.deletionDueDays },
  };
}

const due = (days: number, now: Date) => new Date(now.getTime() + days * 86_400_000).toISOString();

/** Everything ASCENTRA holds about the subject, as JSON. Recorded as a completed export request. */
export async function exportData(account: Account, body: Record<string, unknown>, now = new Date()): Promise<PrivacyResult> {
  const A = "privacy.export";
  if (account.isMinor) return refused(403, TEEN_HANDLED, A, { type: "account", id: account.id });
  const subject = await subjectFor(account, body.forAccountId);
  if (!subject) return refused(404, "You can only download your own data, or a teen's you're the Guardian of.", A);
  const db = getDb();
  // Only the listed fields leave, whatever the table holds (no device key hashes, no Stripe session ids).
  const one = async (table: string, col: string, select = "*") => {
    const list = await rows<Record<string, unknown>>(db.from(table).select(select).eq(col, subject), table);
    if (select === "*") return list;
    const keys = select.split(",").map((k) => k.trim());
    return list.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  };
  // Rows reached two ways (my own consent, given by me) appear once.
  const both = async (table: string, a: string, b: string) =>
    [...new Map([...await one(table, a), ...await one(table, b)].map((r) => [r.id as string, r])).values()];
  const account_ = (await one("accounts", "id",
    "id, email, email_verified, role, status, is_minor, date_of_birth, us_resident_confirmed_at, identity_status, identity_verified_at, created_at, updated_at"))[0];
  const data = {
    exportedAt: now.toISOString(),
    account: account_,
    profile: (await one("profiles", "account_id", "display_name, image_url, updated_at"))[0] ?? null,
    consents: await both("consent_records", "account_id", "actor_account_id"),
    subscriptions: await both("subscriptions", "payer_account_id", "beneficiary_account_id"),
    entitlements: await one("entitlements", "account_id"),
    trustedDevices: await one("trusted_devices", "account_id", "name, kind, approx_region, trust_state, trusted_at, last_seen_at, revoked_at"),
    guardianLinks: [
      ...await one("guardian_relationships", "teen_account_id", "invited_email, verification_status, relationship, authorized_at, withdrawn_at, created_at"),
      ...await one("guardian_relationships", "guardian_account_id", "teen_account_id, verification_status, relationship, authorized_at, withdrawn_at, created_at"),
    ],
    notices: await one("notices", "account_id", "kind, status, sent_at, created_at"),
    privacyRequests: await one("privacy_requests", "account_id", "kind, status, due_at, completed_at, created_at"),
    activity: await one("audit_events", "actor_account_id", "occurred_at, action, context, result"),
  };
  const { error } = await db.from("privacy_requests").insert({
    account_id: subject, requested_by_account_id: account.id, kind: "export", status: "completed",
    due_at: due(PRIVACY_TIMINGS.exportDueDays, now), completed_at: now.toISOString(),
  });
  if (error) throw new Error(`privacy request insert failed: ${error.message}`);
  return {
    ok: true, body: { data },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: subject },
      context: `Downloaded ${subject === account.id ? "their own" : "their teen's"} data (JSON). The export request is recorded as completed.`,
    },
  };
}

/** A deletion request, tracked with a due date (counsel placeholder). Nothing is deleted until it is handled. */
export async function requestDeletion(account: Account, body: Record<string, unknown>, now = new Date()): Promise<PrivacyResult> {
  const A = "privacy.delete.request";
  if (account.isMinor) return refused(403, TEEN_HANDLED, A, { type: "account", id: account.id });
  const subject = await subjectFor(account, body.forAccountId);
  if (!subject) return refused(404, "You can only request deletion of your own account, or a teen's you're the Guardian of.", A);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  const dueAt = due(PRIVACY_TIMINGS.deletionDueDays, now);
  const { data, error } = await getDb().from("privacy_requests").insert({
    account_id: subject, requested_by_account_id: account.id, kind: "deletion", status: "open", due_at: dueAt, note,
  }).select("id").single();
  if (error?.code === "23505") return refused(409, "There's already an open deletion request for this account.", A, { type: "account", id: subject });
  if (error?.code === "42501") return refused(403, "The Owner account can't be deleted.", A, { type: "account", id: subject });
  if (error) throw new Error(`privacy request insert failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { id: (data as { id: string }).id, dueAt },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: subject },
      context: `Requested deletion of ${subject === account.id ? "their own account" : "their teen's account"}. Due by ${dueAt.slice(0, 10)}. Nothing is deleted until it's handled.`,
      next: "open",
    },
  };
}

/**
 * Withdraws the recurring-billing consent: the plan is set to end at the period end (no further charges) and a
 * "withdrawn" row is added. The original consent stays in the history.
 */
export async function withdrawBillingConsent(account: Account, consentId: string, stripe: Stripe | null): Promise<PrivacyResult> {
  const A = "privacy.consent.withdraw";
  const db = getDb();
  const c = UUID.test(consentId)
    ? ((await db.from("consent_records").select("*").eq("id", consentId).maybeSingle()).data as ConsentRow | null) : null;
  if (!c || c.actor_account_id !== account.id) return refused(404, "No such consent of yours.", A);
  const d = (await db.from("legal_document_versions").select("document_key, title, version").eq("id", c.legal_document_version_id).maybeSingle()).data as
    { document_key: string; title: string; version: string } | null;
  if (d?.document_key !== RENEWAL_TERMS_KEY) {
    return refused(400, "Only recurring-billing consent can be withdrawn here. A Guardian withdraws consent for a teen in the Guardian Center.", A);
  }
  const history = await rows<ConsentRow>(db.from("consent_records").select("*").eq("account_id", c.account_id).eq("actor_account_id", account.id)
    .eq("legal_document_version_id", c.legal_document_version_id).order("created_at", { ascending: true }), "consents");
  if (history.at(-1)?.status !== "given") return refused(409, "This consent is already withdrawn.", A);
  const sub = await liveSubscription(account.id, c.account_id);
  if (sub?.processor_subscription_id) {
    if (!stripe) return refused(503, "Billing isn't available right now. Nothing was changed.", A);
    try {
      await stripe.subscriptions.update(sub.processor_subscription_id, { cancel_at_period_end: true });
    } catch (err) {
      console.error("[privacy] cancel at period end failed:", err instanceof Error ? err.message : err);
      return refused(502, "Stripe couldn't cancel the plan, so nothing was changed. Try again.", A);
    }
  }
  const { error } = await db.from("consent_records").insert({
    account_id: c.account_id, actor_account_id: account.id, relation: c.relation, legal_document_version_id: c.legal_document_version_id,
    status: "withdrawn", method: "Withdraw in the Privacy Center",
  });
  if (error) throw new Error(`consent withdrawal failed: ${error.message}`);
  return {
    ok: true, body: { withdrawn: true, planEnds: sub ? sub.renews_at ?? sub.paid_through_at : null },
    event: {
      action: A, result: "Completed", target: { type: "account", id: c.account_id },
      context: `Withdrew consent to the ${d.title} ${d.version} in the Privacy Center. ${sub ? "The plan ends at the end of the period, with no further charges." : "There was no plan to cancel."}`,
      previous: "given", next: "withdrawn",
    },
  };
}
