import "server-only";
import type Stripe from "stripe";
import { clerkClient } from "@clerk/nextjs/server";
import { getDb } from "@/lib/db";
import { recordAudit, SYSTEM_ACTOR, type AuditActor, type AuditInput } from "@/lib/audit";
import type { Account } from "@/lib/auth";
import { findProfile, type AccountRow } from "@/lib/accounts";
import { ADULT_AGE, ageOn, usToday } from "@/lib/age";
import { LIVE_STATUSES, latestSubscription, type SubscriptionRow } from "@/lib/billing";
import { RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION } from "@/lib/billing-terms";
import { GUARDIAN_CONSENT_METHOD, TEEN_DOCUMENTS, TEEN_DOC_KEYS, type TeenDocKey } from "@/lib/teen-documents";

/**
 * B3: Guardian verification and teen activation.
 *   1. A waiting teen names a Guardian; Clerk emails them an invitation to sign up (their own adult account).
 *   2. The Guardian passes Stripe Identity (document + adult check). Only the outcome is kept.
 *   3. The Guardian agrees to the Teen Terms and the Minor Privacy Notice (one consent_records row each).
 *   4. The Guardian pays through B1's checkout as customer of record; the teen becomes active with teen defaults.
 *   5. The Guardian can withdraw consent: the teen is paused (nothing deleted) and the plan ends at the period end.
 * The database enforces the same rules (0010): one Guardian of record per teen, only a verified Guardian authorizes.
 */

export type LinkStatus = "invited" | "pending" | "verified" | "failed";
export type LinkRow = {
  id: string;
  teen_account_id: string;
  guardian_account_id: string | null;
  invited_email: string | null;
  invited_at: string | null;
  verification_status: LinkStatus;
  authorized_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  clerk_invitation_id: string | null;
  relationship: "parent" | "legal_guardian" | null;
  voice_recordings: "off" | "minimal";
  uploads: "private" | "off";
  created_at: string;
};
export type IdentityStatus = "none" | "started" | "processing" | "requires_input" | "verified" | "failed" | "canceled";
export type GuardianRow = AccountRow & { identity_status?: IdentityStatus; identity_verified_at?: string | null; identity_session_id?: string | null };

const OPEN: LinkStatus[] = ["invited", "pending", "verified"];
type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type GuardianResult<T = Record<string, unknown>> =
  | { ok: true; status?: number; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
const refused = (status: number, reason: string, action: string, target: Event["target"] = null): GuardianResult<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============ Reading ============

/** The teen's open link (their Guardian of record, or the open invitation), or null. */
export async function openLinkOfTeen(teenId: string): Promise<LinkRow | null> {
  const { data, error } = await getDb().from("guardian_relationships").select("*").eq("teen_account_id", teenId)
    .is("withdrawn_at", null).in("verification_status", OPEN).maybeSingle();
  if (error) throw new Error(`guardian link lookup failed: ${error.message}`);
  return data as LinkRow | null;
}

/** The teen's most recent link of any kind (a withdrawn or failed one included). */
export async function lastLinkOfTeen(teenId: string): Promise<LinkRow | null> {
  const { data, error } = await getDb().from("guardian_relationships").select("*").eq("teen_account_id", teenId)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`guardian link lookup failed: ${error.message}`);
  return ((data ?? []) as LinkRow[])[0] ?? null;
}

async function linkById(id: string): Promise<LinkRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await getDb().from("guardian_relationships").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`guardian link lookup failed: ${error.message}`);
  return data as LinkRow | null;
}

async function accountById(id: string): Promise<GuardianRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await getDb().from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  return data as GuardianRow | null;
}

/** The Guardian's link to this teen, if it is open (not withdrawn, not failed). */
async function guardianLink(guardianId: string, teenId: string): Promise<LinkRow | null> {
  if (!UUID.test(teenId)) return null;
  const link = await openLinkOfTeen(teenId);
  return link && link.guardian_account_id === guardianId ? link : null;
}

async function docIds(): Promise<Record<TeenDocKey | "renewal", { id: string; body: string; status: string } | null>> {
  const db = getDb();
  const one = async (key: string, version: string) =>
    ((await db.from("legal_document_versions").select("id, body, status").eq("document_key", key).eq("version", version).maybeSingle()).data
      ?? null) as { id: string; body: string; status: string } | null;
  return {
    teen_terms: await one("teen_terms", TEEN_DOCUMENTS.teen_terms.version),
    minor_privacy_notice: await one("minor_privacy_notice", TEEN_DOCUMENTS.minor_privacy_notice.version),
    renewal: await one(RENEWAL_TERMS_KEY, RENEWAL_TERMS_VERSION),
  };
}

/** For each document: is this Guardian's latest consent for this teen "given"? (consent_records is insert-only.) */
export async function consentsOf(guardianId: string, teenId: string): Promise<Record<TeenDocKey | "renewal", boolean>> {
  const docs = await docIds();
  const { data, error } = await getDb().from("consent_records").select("legal_document_version_id, status, created_at")
    .eq("account_id", teenId).eq("actor_account_id", guardianId).eq("relation", "guardian_for_teen").order("created_at", { ascending: true });
  if (error) throw new Error(`consent lookup failed: ${error.message}`);
  const latest = new Map<string, string>();
  for (const r of (data ?? []) as { legal_document_version_id: string; status: string }[]) latest.set(r.legal_document_version_id, r.status);
  const given = (d: { id: string } | null) => !!d && latest.get(d.id) === "given";
  return { teen_terms: given(docs.teen_terms), minor_privacy_notice: given(docs.minor_privacy_notice), renewal: given(docs.renewal) };
}

const nameOf = async (accountId: string, fallback: string) => (await findProfile(accountId))?.display_name ?? fallback;
const guardianActor = (a: Account): AuditActor => ({ accountId: a.id, label: `${a.displayName} (Guardian)`, role: "guardian" });

// ============ 1. The invitation (Clerk sends the email) ============

/**
 * Clerk emails the Guardian an invitation to sign up. The link opens /sign-up with Clerk's ticket; the invitation id
 * travels in the new user's public metadata, and /welcome turns them into a Guardian account for this teen only.
 */
export async function sendGuardianInvitation(link: Pick<LinkRow, "id" | "invited_email" | "clerk_invitation_id">, origin: string): Promise<{ sent: boolean; why?: string }> {
  const clerk = await clerkClient();
  if (link.clerk_invitation_id) await clerk.invitations.revokeInvitation(link.clerk_invitation_id).catch(() => undefined);
  try {
    const inv = await clerk.invitations.createInvitation({
      emailAddress: link.invited_email!, publicMetadata: { ascentra_guardian_invite_id: link.id },
      redirectUrl: `${origin}/sign-up`, notify: true, expiresInDays: 30,
    });
    const { error } = await getDb().from("guardian_relationships").update({ clerk_invitation_id: inv.id }).eq("id", link.id);
    if (error) throw new Error(`invitation id update failed: ${error.message}`);
    return { sent: true };
  } catch (err) {
    const detail = (err as { errors?: { code?: string; longMessage?: string; message?: string }[] })?.errors?.[0];
    const why = detail ? `${detail.longMessage ?? detail.message ?? ""} (${detail.code ?? "no code"})` : err instanceof Error ? err.message : "unknown error";
    console.error("[guardians] Clerk invitation failed:", why);
    return { sent: false, why };
  }
}

// ============ 2. Guardian sign-up (the invitation link → /welcome) ============

/** The invitation a new Clerk user carries, if it is still open and was sent to their verified email. */
export async function invitationFor(inviteId: string, email: string | null): Promise<LinkRow | null> {
  const link = await linkById(inviteId);
  if (!link || link.verification_status !== "invited" || link.withdrawn_at || link.guardian_account_id) return null;
  return email && link.invited_email?.toLowerCase() === email ? link : null;
}

export async function teenFirstName(teenId: string): Promise<string> {
  const name = await nameOf(teenId, "your teen");
  return name.split(/\s+/)[0] || "your teen";
}

/** Links a new Guardian account to the invitation. Only while the invitation is still open (atomic). */
export async function claimInvitation(linkId: string, guardianId: string, relationship: "parent" | "legal_guardian"): Promise<boolean> {
  const { data, error } = await getDb().from("guardian_relationships")
    .update({ guardian_account_id: guardianId, verification_status: "pending", relationship })
    .eq("id", linkId).eq("verification_status", "invited").is("guardian_account_id", null).select("id");
  if (error) throw new Error(`invitation claim failed: ${error.message}`);
  return !!data?.length;
}

// ============ 3. Identity (Stripe Identity, hosted) ============

export async function startIdentity(account: Account, stripe: Stripe, origin: string): Promise<GuardianResult<{ url: string }>> {
  const A = "guardian.identity.verify";
  const me = await accountById(account.id);
  if (!me || me.role !== "guardian") return refused(403, "Only a Guardian account verifies its identity here.", A);
  if (me.identity_status === "verified") return refused(409, "Your identity is already verified.", A, { type: "account", id: me.id });
  if (me.identity_status === "failed") {
    return refused(409, "The identity check didn't confirm that you're an adult. Contact Support.", A, { type: "account", id: me.id });
  }
  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    options: { document: { allowed_types: ["driving_license", "passport", "id_card"], require_live_capture: true, require_matching_selfie: true } },
    provided_details: { email: me.email },
    client_reference_id: me.id,
    metadata: { account_id: me.id, purpose: "ascentra_guardian" },
    return_url: `${origin}/guardian?identity=done`,
  });
  const { error } = await getDb().from("accounts")
    .update({ identity_status: "started", identity_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", me.id);
  if (error) throw new Error(`identity start failed: ${error.message}`);
  return {
    ok: true, body: { url: session.url! },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: me.id, label: me.email },
      context: "Started the Stripe Identity check (ID document and selfie; adult status). Stripe keeps the images; ASCENTRA keeps only the result.",
      previous: me.identity_status ?? "none", next: "started",
    },
  };
}

const IDENTITY_STATUS: Record<string, IdentityStatus> = { processing: "processing", requires_input: "requires_input", canceled: "canceled" };

/**
 * A Stripe Identity event. The session is read again from Stripe (the newest state wins). Only "verified" with a date
 * of birth that makes the Guardian 18 or older counts. The date of birth is read to decide, never stored.
 */
export async function applyIdentityEvent(event: Stripe.Event, stripe: Stripe): Promise<{ outcome: string; accountId: string | null }> {
  const obj = event.data.object as Stripe.Identity.VerificationSession;
  const accountId = obj.metadata?.account_id ?? null;
  if (!accountId || obj.metadata?.purpose !== "ascentra_guardian") return { outcome: "ignored", accountId: null };
  const me = await accountById(accountId);
  // Only the session this account started last counts.
  if (!me || me.role !== "guardian" || me.identity_session_id !== obj.id) return { outcome: "ignored_session", accountId };
  if (me.identity_status === "verified" || me.identity_status === "failed") return { outcome: "already_decided", accountId };

  const session = await stripe.identity.verificationSessions.retrieve(obj.id, { expand: ["verified_outputs", "verified_outputs.dob"] });
  let next: IdentityStatus;
  let context: string;
  if (session.status === "verified") {
    const dob = session.verified_outputs?.dob;
    const adult = !!(dob?.year && dob.month && dob.day) && ageOn({ y: dob.year, m: dob.month, d: dob.day }, usToday()) >= ADULT_AGE;
    next = adult ? "verified" : "failed";
    context = adult
      ? "Stripe Identity verified the Guardian's ID document and that they are 18 or older."
      : "Stripe Identity verified a document, but not that the Guardian is 18 or older. The Guardian can't authorize a teen.";
  } else {
    next = IDENTITY_STATUS[session.status] ?? "processing";
    context = next === "requires_input"
      ? `Stripe Identity couldn't verify the document (${session.last_error?.code ?? "no reason given"}). The Guardian can try again.`
      : `Stripe Identity: ${session.status}.`;
  }
  if (next === me.identity_status) return { outcome: `unchanged (${next})`, accountId };
  const now = new Date().toISOString();
  const { error } = await getDb().from("accounts").update({
    identity_status: next, identity_verified_at: next === "verified" ? now : null, updated_at: now,
  }).eq("id", me.id);
  if (error) throw new Error(`identity update failed: ${error.message}`);
  if (next === "failed") {
    // The teen can invite a different adult.
    await getDb().from("guardian_relationships").update({ verification_status: "failed" })
      .eq("guardian_account_id", me.id).eq("verification_status", "pending").is("withdrawn_at", null);
  }
  await recordAudit({
    actor: SYSTEM_ACTOR("Stripe Identity webhook"), action: "guardian.identity", requestId: event.id, sensitive: true,
    context, target: { type: "account", id: me.id, label: me.email }, previous: me.identity_status ?? "none", next,
    result: next === "failed" ? "Blocked" : "Completed",
  });
  return { outcome: `identity_${next}`, accountId: me.id };
}

// ============ 4. Consent (one row per document) ============

export async function giveConsents(account: Account, teenId: string, body: Record<string, unknown>): Promise<GuardianResult> {
  const A = "guardian.consent.give";
  const target = { type: "account", id: teenId };
  const link = await guardianLink(account.id, teenId);
  if (!link) return refused(404, "This teen isn't linked to your account.", A, target);
  if (link.verification_status !== "pending") return refused(409, "This teen's account is already authorized.", A, target);
  const me = await accountById(account.id);
  if (me?.identity_status !== "verified") return refused(403, "Verify your identity first. Only a verified adult can agree for a teen.", A, target);
  const agreed = (body.agreed ?? {}) as Record<string, unknown>;
  for (const key of TEEN_DOC_KEYS) {
    if (agreed[key] !== TEEN_DOCUMENTS[key].version) {
      return refused(400, `Agree to the ${TEEN_DOCUMENTS[key].title} (${TEEN_DOCUMENTS[key].version}) to continue. Each one is its own checkbox.`, A, target);
    }
  }
  const docs = await docIds();
  for (const key of TEEN_DOC_KEYS) {
    const d = docs[key];
    if (!d || d.status !== "published" || d.body !== TEEN_DOCUMENTS[key].body) {
      console.error(`[guardians] ${key} in the database doesn't match the text shown (apply db/apply/B3.sql).`);
      return refused(503, "This step isn't available right now. Nothing was recorded.", A, target);
    }
  }
  const already = await consentsOf(account.id, teenId);
  const db = getDb();
  for (const key of TEEN_DOC_KEYS) {
    if (already[key]) continue;
    const { error } = await db.from("consent_records").insert({
      account_id: teenId, actor_account_id: account.id, relation: "guardian_for_teen",
      legal_document_version_id: docs[key]!.id, status: "given", method: GUARDIAN_CONSENT_METHOD,
    });
    if (error) throw new Error(`consent insert failed: ${error.message}`);
  }
  const teen = await teenFirstName(teenId);
  return {
    ok: true, body: { agreed: true },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: teenId, label: teen },
      context: `Agreed for ${teen} to the ${TEEN_DOC_KEYS.map((k) => `${TEEN_DOCUMENTS[k].title} ${TEEN_DOCUMENTS[k].version}`).join(" and the ")} (${GUARDIAN_CONSENT_METHOD}).`,
      next: TEEN_DOC_KEYS.map((k) => `${k} ${TEEN_DOCUMENTS[k].version}`).join(", "),
    },
  };
}

// ============ 5. Checkout for a teen (B1's checkout, Guardian as customer of record) ============

/** Why this Guardian can't check out for this teen yet, or null. */
export async function teenCheckoutRefusal(guardianId: string, teenId: unknown): Promise<string | null> {
  if (typeof teenId !== "string" || !UUID.test(teenId)) return "Choose which teen this plan is for.";
  const link = await guardianLink(guardianId, teenId);
  if (!link) return "This teen isn't linked to your account.";
  if (link.verification_status !== "pending") return "This teen's account is already authorized. Change the plan from Manage billing.";
  const me = await accountById(guardianId);
  if (me?.identity_status !== "verified") return "Verify your identity first.";
  const c = await consentsOf(guardianId, teenId);
  if (!c.teen_terms || !c.minor_privacy_notice) return "Agree to the Teen Terms and the Minor Privacy Notice first.";
  return null;
}

/** Whether the beneficiary named in a Stripe subscription's metadata may be paid for by this payer. */
export async function mayPayFor(payerId: string, beneficiaryId: string): Promise<boolean> {
  if (!UUID.test(beneficiaryId)) return false;
  const link = await openLinkOfTeen(beneficiaryId);
  return !!link && link.guardian_account_id === payerId;
}

/**
 * A Guardian's subscription for a teen is live: the teen becomes active, with teen defaults. Safe to repeat (every
 * subscription event for it arrives here) and does nothing for a withdrawn or unpaid link.
 */
export async function activateTeenIfPaid(row: SubscriptionRow, eventId: string): Promise<string | null> {
  if (row.beneficiary_account_id === row.payer_account_id) return null;
  if (row.status !== "trialing" && row.status !== "active") return null;
  const link = await openLinkOfTeen(row.beneficiary_account_id);
  if (!link || link.guardian_account_id !== row.payer_account_id) return null;
  const teen = await accountById(row.beneficiary_account_id);
  if (!teen || teen.status === "active" && link.verification_status === "verified") return null;
  if (teen.status !== "pending") return null;
  const db = getDb();
  const actor = SYSTEM_ACTOR("Stripe webhook");
  const refusal = await teenCheckoutRefusal(row.payer_account_id, teen.id);
  if (link.verification_status === "pending" && refusal) {
    await recordAudit({
      actor, action: "guardian.teen.activate", requestId: eventId, result: "Blocked", sensitive: true,
      context: `A plan was paid for a teen, but the account wasn't activated: ${refusal}`, target: { type: "account", id: teen.id, label: teen.email },
    });
    return "not_ready";
  }
  const now = new Date().toISOString();
  if (link.verification_status === "pending") {
    const { error } = await db.from("guardian_relationships")
      .update({ verification_status: "verified", authorized_at: now, voice_recordings: "off", uploads: "private" })
      .eq("id", link.id).eq("verification_status", "pending");
    if (error) throw new Error(`guardian authorization failed: ${error.message}`);
  }
  const { error } = await db.from("accounts").update({ status: "active", updated_at: now }).eq("id", teen.id).eq("status", "pending");
  if (error) throw new Error(`teen activation failed: ${error.message}`);
  // Teen defaults: in-app notices only (no email), voice recordings off and uploads private (on the link above).
  await db.from("notification_preferences").upsert({ account_id: teen.id, in_app: true, email: false, weekly_reminder: true, reminder_before_due: false });
  await recordAudit({
    actor, action: "guardian.teen.activate", requestId: eventId, result: "Completed", sensitive: true,
    context: "The Guardian of record is verified, agreed to the teen documents and pays as customer of record: the teen account is active, with teen defaults (voice recordings off, uploads private, no email).",
    target: { type: "account", id: teen.id, label: teen.email }, previous: "pending", next: "active",
  });
  return "teen_activated";
}

// ============ 6. Withdrawal ============

/**
 * The Guardian withdraws consent for a teen: a "withdrawn" consent row for each document they had agreed to, the link
 * closed, the teen paused (nothing deleted) and the plan set to end at the period end (no further charges).
 */
export async function withdrawConsent(account: Account, teenId: string, reason: string, stripe: Stripe | null): Promise<GuardianResult> {
  const A = "guardian.consent.withdraw";
  const target = { type: "account", id: teenId };
  const link = await guardianLink(account.id, teenId);
  if (!link) return refused(404, "This teen isn't linked to your account.", A, target);
  const teen = await accountById(teenId);
  if (!teen) return refused(404, "This teen isn't linked to your account.", A, target);

  const sub = await latestSubscription(teenId);
  const live = sub && LIVE_STATUSES.includes(sub.status) && sub.payer_account_id === account.id && !sub.cancel_at_period_end ? sub : null;
  if (live?.processor_subscription_id) {
    if (!stripe) return refused(503, "Billing isn't available right now, so consent can't be withdrawn yet. Nothing was changed.", A, target);
    try {
      await stripe.subscriptions.update(live.processor_subscription_id, { cancel_at_period_end: true });
    } catch (err) {
      console.error("[guardians] cancel at period end failed:", err instanceof Error ? err.message : err);
      return refused(502, "Stripe couldn't cancel the plan, so nothing was changed. Try again.", A, target);
    }
  }

  const db = getDb();
  const docs = await docIds();
  const given = await consentsOf(account.id, teenId);
  for (const key of [...TEEN_DOC_KEYS, "renewal"] as const) {
    if (!given[key] || !docs[key]) continue;
    const { error } = await db.from("consent_records").insert({
      account_id: teenId, actor_account_id: account.id, relation: "guardian_for_teen",
      legal_document_version_id: docs[key]!.id, status: "withdrawn", method: "Withdraw consent in the Guardian Center",
    });
    if (error) throw new Error(`consent withdrawal failed: ${error.message}`);
  }
  const now = new Date().toISOString();
  const closed = await db.from("guardian_relationships").update({ withdrawn_at: now, withdrawal_reason: reason }).eq("id", link.id).is("withdrawn_at", null);
  if (closed.error) throw new Error(`link withdrawal failed: ${closed.error.message}`);
  const paused = await db.from("accounts").update({ status: "paused", updated_at: now }).eq("id", teenId).in("status", ["active", "pending"]);
  if (paused.error) throw new Error(`teen pause failed: ${paused.error.message}`);

  const name = await teenFirstName(teenId);
  return {
    ok: true, body: { withdrawn: true, planEnds: live ? live.paid_through_at ?? live.renews_at : null },
    event: {
      action: A, result: "Completed", sensitive: true, target: { type: "account", id: teenId, label: teen.email },
      context: `Withdrew consent for ${name}. The teen account is paused, not deleted; progress is kept. ${live ? "The plan ends at the end of the period, with no further charges." : "There was no plan to cancel."} Both accounts see it the next time they open ASCENTRA.`,
      previous: teen.status, next: "paused",
    },
  };
}

// ============ The Guardian Center ============

export async function guardianOverview(account: Account) {
  const me = await accountById(account.id);
  const { data, error } = await getDb().from("guardian_relationships").select("*").eq("guardian_account_id", account.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`guardian links failed: ${error.message}`);
  const teens = [];
  for (const link of (data ?? []) as LinkRow[]) {
    const teen = await accountById(link.teen_account_id);
    const sub = await latestSubscription(link.teen_account_id);
    teens.push({
      id: link.teen_account_id,
      name: await teenFirstName(link.teen_account_id),
      status: teen?.status ?? "disabled",
      link: link.withdrawn_at ? "withdrawn" : link.verification_status,
      authorizedAt: link.authorized_at,
      withdrawnAt: link.withdrawn_at,
      consents: await consentsOf(account.id, link.teen_account_id),
      defaults: { voiceRecordings: link.voice_recordings, uploads: link.uploads },
      subscription: sub && sub.payer_account_id === account.id && LIVE_STATUSES.includes(sub.status)
        ? { plan: sub.plan, status: sub.status, renewsAt: sub.renews_at, paidThrough: sub.paid_through_at } : null,
    });
  }
  return {
    identity: { status: me?.identity_status ?? "none", verifiedAt: me?.identity_verified_at ?? null },
    teens,
    documents: TEEN_DOC_KEYS.map((k) => ({ key: k, ...TEEN_DOCUMENTS[k] })),
  };
}

export { guardianActor };
