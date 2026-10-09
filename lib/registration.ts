import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { SYSTEM_ACTOR, recordAudit, type AuditActor } from "@/lib/audit";
import {
  accountFields, findAccountByClerkId, findLiveAssignment, findProfile, identityFromClerkUser, upsertProfile,
  type AccountRow, type ClerkIdentity,
} from "@/lib/accounts";
import { accountRefusal } from "@/lib/auth";
import { ageGroup, ageOn, isoDate, parseDob, usToday } from "@/lib/age";
import { createRateLimiter } from "@/lib/rate-limit";
import { claimInvitation, consentsOf, invitationFor, lastLinkOfTeen, openLinkOfTeen, sendGuardianInvitation, teenFirstName, type LinkRow } from "@/lib/guardians";
import { latestSubscription, tierOf } from "@/lib/billing";

/**
 * B2: the sign-up step. After Clerk sign-up, a Clerk user has no ASCENTRA account until they give their date
 * of birth and confirm they live in the US. The server computes the age:
 *   under 14 → refused; nothing is stored and the Clerk user is deleted;
 *   14 to 17 → a pending teen learner (is_minor), who can only invite a Guardian until the Guardian authorizes;
 *   18 or older → an active adult learner, who can go to checkout.
 * The Owner and invited admins never come through here: their accounts are made by the Clerk webhook.
 * B3: a Guardian comes through here from the invitation email a teen asked for; their account is a Guardian
 * account for that teen only (lib/guardians.ts takes it from there).
 * R1: the order for a learner is account → date of birth and US → "Choose your path" (the five questions and a
 * business) → plan and the 14-day trial (adults only; a teen's Guardian chooses and pays) → the learner home. The
 * server works out the next unfinished step every time, so leaving and coming back resumes where they were.
 */

/** What the person sees after a refusal for age. No hint to try again. */
export const NOT_ELIGIBLE = "We can't create an account. ASCENTRA isn't available for this account. Nothing you entered was saved.";
export const US_ONLY = "ASCENTRA is available in the United States only. Confirm that you live in the US to continue.";
export const DOB_INVALID = "Enter a real date, like March 4 2001.";
export const DOB_ALREADY_SET = "Your date of birth is already set. Only Support can change it.";

/** Where a teen waiting for their Guardian stands (shown on "Waiting for your Guardian"). */
export type GuardianProgress = "none" | "invited" | "joined" | "verified" | "agreed" | "failed";

export type RegistrationState =
  | { state: "dob" }
  | { state: "guardian"; guardianEmail: string | null; progress: GuardianProgress; emailSent: boolean }
  | { state: "guardian_signup"; teenName: string }
  | { state: "paused"; since: string | null }
  | { state: "second_factor" }
  | { state: "interview"; next: string }
  | { state: "plan" }
  | { state: "ready"; home: string }
  | { state: "not_open"; reason: string };

export type Result =
  | { ok: true; status: number; body: RegistrationState }
  | { ok: false; status: number; error: string; reason: string };

const fail = (status: number, reason: string, error = status === 409 ? "conflict" : status === 403 ? "forbidden" : "invalid_request"): Result =>
  ({ ok: false, status, error, reason });

async function clerkIdentity(clerkUserId: string): Promise<ClerkIdentity> {
  const user = await (await clerkClient()).users.getUser(clerkUserId);
  if (!user.raw) throw new Error("Clerk returned a user without its data");
  return identityFromClerkUser(user.raw);
}

/**
 * Why this Clerk user can't take the sign-up step, or null. The Owner and admins are never learners: they are
 * never asked for a date of birth, so nothing here can make them a minor or pending.
 */
async function signupBlock(identity: ClerkIdentity, ownerEmail: string): Promise<string | null> {
  if (!identity.email || !identity.emailVerified) return "Verify your email address first, then sign in again.";
  if (identity.email === ownerEmail.trim().toLowerCase()) return "This is the Owner's sign-in. It doesn't use the sign-up step.";
  if (identity.inviteId) return "This sign-in comes from an administrator invitation. Your role starts once a second factor is on.";
  if (identity.guardianInviteId) return "This sign-in comes from a Guardian invitation that is no longer open. Ask the teen to send it again.";
  const { data, error } = await getDb().from("role_assignments").select("id").eq("invited_email", identity.email)
    .in("status", ["invited", "claimed", "active"]).limit(1);
  if (error) throw new Error(`invite lookup failed: ${error.message}`);
  if (data?.length) return "This email has an administrator invitation. Use the link in the invitation email.";
  return null;
}

const isWaitingTeen = (row: AccountRow) => row.role === "learner" && row.is_minor && row.status === "pending";

async function teenProgress(teenId: string): Promise<Extract<RegistrationState, { state: "guardian" }>> {
  const link = await openLinkOfTeen(teenId);
  if (!link) {
    const last = await lastLinkOfTeen(teenId);
    return { state: "guardian", guardianEmail: null, progress: last?.verification_status === "failed" ? "failed" : "none", emailSent: false };
  }
  let progress: GuardianProgress = link.verification_status === "invited" ? "invited" : "joined";
  if (link.guardian_account_id) {
    const g = (await getDb().from("accounts").select("identity_status").eq("id", link.guardian_account_id).maybeSingle()).data as { identity_status?: string } | null;
    if (g?.identity_status === "verified") progress = "verified";
    const c = progress === "verified" ? await consentsOf(link.guardian_account_id, teenId) : null;
    if (c?.teen_terms && c.minor_privacy_notice) progress = "agreed";
  }
  return { state: "guardian", guardianEmail: link.invited_email, progress, emailSent: !!link.clerk_invitation_id || !!link.guardian_account_id };
}

/** Where the "Choose your path" step lives, and the learner home. */
export const INTERVIEW_PATH = "/learn/choose?onboarding=1";
export const LEARNER_HOME = "/";

/** R1: the interview step is done once the five answers are saved and a business is picked. */
export async function interviewDone(accountId: string): Promise<boolean> {
  const db = getDb();
  const p = (await db.from("profiles").select("path_answered_at").eq("account_id", accountId).maybeSingle()).data as { path_answered_at: string | null } | null;
  if (!p?.path_answered_at) return false;
  const { data, error } = await db.from("learner_picks").select("id").eq("user_id", accountId).eq("kind", "business").eq("status", "active").limit(1);
  if (error) throw new Error(`picks lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * R1: the plan step is done once the learner has a plan (or the trial), or has ever started one: someone whose trial
 * ended isn't sent back to the plan step; they change plans from Account.
 */
async function planDone(row: AccountRow): Promise<boolean> {
  if ((await tierOf({ id: row.id, roleKey: "learner" })).tier !== "none") return true;
  return !!(await latestSubscription(row.id));
}

async function stateOfAccount(row: AccountRow, ownerEmail: string): Promise<RegistrationState> {
  if (isWaitingTeen(row)) return teenProgress(row.id);
  if (row.role === "learner" && row.status === "paused") return { state: "paused", since: (await lastLinkOfTeen(row.id))?.withdrawn_at ?? null };
  const refusal = accountRefusal(row, row.role === "admin" ? await findLiveAssignment(row.id) : null, ownerEmail);
  if (!refusal) {
    if (row.role === "learner") {
      if (!(await interviewDone(row.id))) return { state: "interview", next: INTERVIEW_PATH };
      // A teen's plan is the Guardian's: an active teen goes straight to the learner home.
      if (!row.is_minor && !(await planDone(row))) return { state: "plan" };
      return { state: "ready", home: LEARNER_HOME };
    }
    return { state: "ready", home: row.role === "guardian" ? "/guardian" : "/account" };
  }
  // R1: only the Owner, an admin (an invited admin's role starts once it's on) or a Guardian. Never a learner.
  if (refusal === "second_factor_missing") return { state: "second_factor" };
  return { state: "not_open", reason: "This account doesn't have access." };
}

/** Where this signed-in Clerk user stands. */
export async function registrationState(clerkUserId: string, ownerEmail: string): Promise<RegistrationState> {
  const row = await findAccountByClerkId(clerkUserId);
  if (row) return stateOfAccount(row, ownerEmail);
  const identity = await clerkIdentity(clerkUserId);
  const invite = identity.guardianInviteId ? await guardianInvitation(identity, ownerEmail) : null;
  if (invite) return { state: "guardian_signup", teenName: await teenFirstName(invite.teen_account_id) };
  const block = await signupBlock(identity, ownerEmail);
  return block ? { state: "not_open", reason: block } : { state: "dob" };
}

const learnerActor = (id: string, label: string, teen: boolean): AuditActor =>
  ({ accountId: id, label: `${label} (Learner${teen ? ", waiting for Guardian" : ""})`, role: "learner" });

/** The sign-up step. Body: { dateOfBirth: "YYYY-MM-DD", usResident: true }. */
export async function register(clerkUserId: string, body: Record<string, unknown>, ownerEmail: string, now = new Date()): Promise<Result> {
  if (await findAccountByClerkId(clerkUserId)) return fail(409, DOB_ALREADY_SET);
  const identity = await clerkIdentity(clerkUserId);
  const block = await signupBlock(identity, ownerEmail);
  if (block) return fail(403, block);
  if (body.usResident !== true) return fail(400, US_ONLY);
  const today = usToday(now);
  const dob = parseDob(body.dateOfBirth, today);
  if (!dob) return fail(400, DOB_INVALID);
  const group = ageGroup(ageOn(dob, today));

  if (group === "under_minimum") {
    // Nothing is stored: no account, no date of birth, nothing identifying in the log or the audit event.
    try {
      await (await clerkClient()).users.deleteUser(clerkUserId);
    } catch (err) {
      console.error("[registration] could not delete a refused sign-in:", err instanceof Error ? err.message : "unknown error");
    }
    await recordAudit({
      actor: SYSTEM_ACTOR("Sign-up step"), action: "registration.refused",
      context: "A sign-up was refused: ASCENTRA is for learners 14 and older. Nothing entered was kept, and the new sign-in was deleted.",
      result: "Blocked", sensitive: true,
    });
    return fail(403, NOT_ELIGIBLE, "not_eligible");
  }

  const teen = group === "teen";
  const db = getDb();
  const { data, error } = await db.from("accounts").insert({
    clerk_user_id: clerkUserId, role: "learner", status: teen ? "pending" : "active", is_minor: teen,
    date_of_birth: isoDate(dob), us_resident_confirmed_at: now.toISOString(), ...accountFields(identity),
  }).select("id").single();
  // 23505: another request for this Clerk user got there first. 23514: the database's own age check refused it.
  if (error?.code === "23505") return fail(409, DOB_ALREADY_SET);
  if (error?.code === "23514") return fail(400, DOB_INVALID);
  if (error) throw new Error(`learner insert failed: ${error.message}`);
  const id = data.id as string;
  await upsertProfile(id, identity);
  await recordAudit({
    actor: learnerActor(id, identity.displayName, teen),
    action: teen ? "registration.teen" : "registration.adult",
    context: teen
      ? "Signed up as a teen learner (14 to 17, US). The account waits for a verified Guardian; until then it can't learn, pay or message."
      : "Signed up as an adult learner (18 or older, US). The date of birth is on file and can only be changed by Support.",
    target: { type: "account", id, label: identity.email }, previous: "none",
    next: teen ? "teen learner, waiting for Guardian" : "adult learner, active", result: "Completed",
  });
  return { ok: true, status: 201, body: await stateOfAccount((await findAccountByClerkId(clerkUserId))!, ownerEmail) };
}

const guardianLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });
const emailSchema = z.email();
const CANT_BE_GUARDIAN = "That email can't be used for a Guardian. Ask your parent or guardian for a different email.";

/**
 * A waiting teen names their Guardian, and Clerk emails the Guardian an invitation to sign up (B3). Until the
 * Guardian signs up, the teen can change the email or send it again; each change is audited. A Guardian who
 * already has an ASCENTRA account is linked at once (no new sign-up needed).
 * Body: { guardianEmail, resend?: true }.
 */
export async function inviteGuardian(clerkUserId: string, body: Record<string, unknown>, origin: string, now = new Date()): Promise<Result> {
  const row = await findAccountByClerkId(clerkUserId);
  if (!row || !isWaitingTeen(row)) return fail(403, "Only a teen account waiting for its Guardian can do this.");
  const email = typeof body.guardianEmail === "string" ? body.guardianEmail.trim().toLowerCase() : "";
  if (!emailSchema.safeParse(email).success) return fail(400, "Enter your parent or guardian's email, like name@example.com.");
  if (email === row.email.toLowerCase()) return fail(400, "Enter your parent or guardian's email, not your own.");
  const open = await openLinkOfTeen(row.id);
  if (open && open.verification_status !== "invited") return fail(409, "Your Guardian has already joined. Ask them to finish setting up your account.");
  const resend = body.resend === true && open?.invited_email === email;
  if (open?.invited_email === email && open.clerk_invitation_id && !resend) return { ok: true, status: 200, body: await teenProgress(row.id) };
  if (!guardianLimiter.check(row.id, now.getTime()).ok) return fail(429, "Too many changes. Try again in an hour.", "rate_limited");

  const db = getDb();
  const existing = (await db.from("accounts").select("id, role, status").eq("email", email).limit(1)).data as { id: string; role: string; status: string }[] | null;
  const guardian = existing?.[0];
  if (guardian && (guardian.role !== "guardian" || guardian.status !== "active")) return fail(400, CANT_BE_GUARDIAN);

  let link: LinkRow;
  if (open) {
    const { data, error } = await db.from("guardian_relationships").update({ invited_email: email, invited_at: now.toISOString() })
      .eq("id", open.id).eq("verification_status", "invited").select("*");
    if (error) throw new Error(`guardian invitation failed: ${error.message}`);
    if (!data?.length) return fail(409, "Your Guardian invitation changed at the same time. Reload the page.");
    link = data[0] as LinkRow;
  } else {
    const { data, error } = await db.from("guardian_relationships").insert({
      teen_account_id: row.id, invited_email: email, invited_at: now.toISOString(), verification_status: "invited",
    }).select("*").single();
    if (error?.code === "23505") return fail(409, "Your Guardian invitation changed at the same time. Reload the page.");
    if (error) throw new Error(`guardian invitation failed: ${error.message}`);
    link = data as LinkRow;
  }

  let sent: { sent: boolean; why?: string } = { sent: false };
  if (guardian) {
    // An existing Guardian (another teen of theirs): linked now; they see this teen in their Guardian Center.
    if (!(await claimInvitation(link.id, guardian.id, "parent"))) return fail(409, "Your Guardian invitation changed at the same time. Reload the page.");
    sent = { sent: true };
  } else {
    sent = await sendGuardianInvitation(link, origin);
  }
  const profile = await findProfile(row.id);
  await recordAudit({
    actor: learnerActor(row.id, profile?.display_name ?? row.email, true), action: "guardian.invite",
    context: guardian
      ? "A teen named a Guardian who already has an ASCENTRA Guardian account. They are linked; the Guardian finishes setup in their Guardian Center."
      : sent.sent
        ? `A teen ${resend ? "sent their Guardian invitation again" : "named their Guardian"}. Clerk emailed the invitation to sign up.`
        : `A teen named their Guardian. The invitation is saved, but the email couldn't be sent: ${sent.why}`,
    target: { type: "account", id: row.id, label: row.email }, previous: open?.invited_email ?? "none", next: email,
    result: "Completed",
  });
  const state = await teenProgress(row.id);
  if (!sent.sent) return fail(502, "Your invitation is saved, but the email couldn't be sent. Try \"Send again\" in a few minutes.", "email_failed");
  return { ok: true, status: open ? 200 : 201, body: state };
}

/** The open Guardian invitation this new Clerk user carries, for their verified email, or null. */
async function guardianInvitation(identity: ClerkIdentity, ownerEmail: string): Promise<LinkRow | null> {
  if (!identity.guardianInviteId || !identity.email || !identity.emailVerified) return null;
  if (identity.email === ownerEmail.trim().toLowerCase() || identity.inviteId) return null;
  return invitationFor(identity.guardianInviteId, identity.email);
}

/**
 * The Guardian's sign-up step (from the invitation email): an adult Guardian account, in the US, linked to the
 * teen who invited them. Body: { adult: true, usResident: true, relationship: "parent" | "legal_guardian" }.
 * Their identity and adult status are then checked by Stripe Identity in the Guardian Center.
 */
export async function registerGuardian(clerkUserId: string, body: Record<string, unknown>, ownerEmail: string, now = new Date()): Promise<Result> {
  if (await findAccountByClerkId(clerkUserId)) return fail(409, "This sign-in already has an ASCENTRA account.");
  const identity = await clerkIdentity(clerkUserId);
  const invite = await guardianInvitation(identity, ownerEmail);
  if (!invite) return fail(403, "This Guardian invitation is no longer open. Ask the teen to send it again.");
  if (body.adult !== true) return fail(400, "A Guardian must be 18 or older. Confirm that you are.");
  if (body.usResident !== true) return fail(400, US_ONLY);
  const relationship = body.relationship === "parent" || body.relationship === "legal_guardian" ? body.relationship : null;
  if (!relationship) return fail(400, "Choose whether you're the teen's parent or legal guardian.");

  const db = getDb();
  const { data, error } = await db.from("accounts").insert({
    clerk_user_id: clerkUserId, role: "guardian", status: "active", is_minor: false,
    us_resident_confirmed_at: now.toISOString(), ...accountFields(identity),
  }).select("id").single();
  if (error?.code === "23505") return fail(409, "This sign-in already has an ASCENTRA account.");
  if (error) throw new Error(`guardian insert failed: ${error.message}`);
  const id = data.id as string;
  if (!(await claimInvitation(invite.id, id, relationship))) {
    await db.from("accounts").delete().eq("id", id);
    return fail(409, "This Guardian invitation was used at the same time. Ask the teen to send it again.");
  }
  await upsertProfile(id, identity);
  const teen = await teenFirstName(invite.teen_account_id);
  await recordAudit({
    actor: { accountId: id, label: `${identity.displayName} (Guardian)`, role: "guardian" }, action: "guardian.signup",
    context: `Signed up as ${teen}'s Guardian (${relationship === "parent" ? "parent" : "legal guardian"}, 18 or older, US) from the invitation email. Identity and adult status are checked next (Stripe Identity).`,
    target: { type: "account", id: invite.teen_account_id, label: teen }, previous: "invited", next: "Guardian joined", result: "Completed",
  });
  return { ok: true, status: 201, body: await stateOfAccount((await findAccountByClerkId(clerkUserId))!, ownerEmail) };
}
