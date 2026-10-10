import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid, refused, type Result } from "@/lib/courses/common";
import { MISSION_TYPES, TEEN_MISSION_LIMITS, US_STATES, isMissionType, isStateCode } from "@/lib/progress/config";

/**
 * C2: real-world missions (an activity item with a mission type) and teens.
 *   An adult does a mission with no Guardian step.
 *   A teen (14 to 17) does one only when: their state is on the Owner's allow-list for that mission type (off for teens in
 *   every state until the Owner, with their lawyer, turns it on); their Guardian approved missions for this course (once
 *   per course; the Guardian sees the request in the Guardian Center); and, for a mission that contacts someone, their
 *   Guardian approved it this time (each approval is used once).
 *   Whatever the approval, a teen never messages private individuals, meets anyone in person, shares personal details, or
 *   handles real client money or accounts (TEEN_MISSION_LIMITS, shown with every mission).
 * The state is private: the learner, the server and authorized staff only.
 */

/** Pure: the decision for one teen and one mission, from the facts. Tested branch by branch (tests/unit/missions.test.ts). */
export function decideMission(f: {
  minor: boolean; missionType: string; state: string | null; allowedStates: string[]; courseApproved: boolean; contactApproved: boolean;
}): { ok: true } | { ok: false; reason: string; need: "state" | "allow_list" | "course_approval" | "contact_approval" | "unknown" } {
  if (!isMissionType(f.missionType)) return { ok: false, reason: "This mission isn't set up yet.", need: "unknown" };
  if (!f.minor) return { ok: true };
  if (!f.state) return { ok: false, reason: "Add your state in Account first. Real-world missions for teens depend on it.", need: "state" };
  if (!f.allowedStates.includes(f.state)) return { ok: false, reason: "This kind of real-world mission isn't open to teens in your state yet. Do the practice version instead.", need: "allow_list" };
  if (!f.courseApproved) return { ok: false, reason: "Your Guardian needs to approve real-world missions for this course first. Ask them from this page.", need: "course_approval" };
  if (MISSION_TYPES[f.missionType].contacts && !f.contactApproved) {
    return { ok: false, reason: "This mission contacts someone, so your Guardian approves it each time. Ask them from this page.", need: "contact_approval" };
  }
  return { ok: true };
}

export async function stateOf(accountId: string): Promise<string | null> {
  return ((await getDb().from("account_regions").select("state_code").eq("account_id", accountId).maybeSingle()).data as { state_code: string } | null)?.state_code ?? null;
}

async function approvals(teenId: string, academyId: string) {
  return ((await getDb().from("mission_approvals").select("id, scope, item_id, status").eq("teen_account_id", teenId).eq("academy_id", academyId)).data ?? []) as
    { id: string; scope: string; item_id: string | null; status: string }[];
}

/** Whether this learner may do this mission now. */
export async function missionGate(actor: Pick<Account, "id" | "isMinor">, missionType: string, academyId: string, itemId: string) {
  if (!actor.isMinor) return decideMission({ minor: false, missionType, state: null, allowedStates: [], courseApproved: true, contactApproved: true });
  const db = getDb();
  const state = await stateOf(actor.id);
  const allowed = ((await db.from("mission_state_allowlist").select("state_code").eq("mission_type", missionType).eq("teens_allowed", true)).data ?? []) as { state_code: string }[];
  const mine = await approvals(actor.id, academyId);
  return decideMission({
    minor: true, missionType, state, allowedStates: allowed.map((a) => a.state_code),
    courseApproved: mine.some((a) => a.scope === "course" && a.status === "approved"),
    contactApproved: mine.some((a) => a.scope === "contact" && a.item_id === itemId && a.status === "approved"),
  });
}

/** A contact approval is used once. */
export async function spendContactApproval(teenId: string, academyId: string, itemId: string) {
  await getDb().from("mission_approvals").update({ status: "used", used_at: new Date().toISOString() })
    .eq("teen_account_id", teenId).eq("academy_id", academyId).eq("scope", "contact").eq("item_id", itemId).eq("status", "approved");
}

/** The learner's private state (set at sign-up, or later in Account). Body: { state }. */
export async function setState(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "account.state";
  if (!isStateCode(body.state)) return refused(400, "Choose your state.", A);
  const db = getDb();
  const before = await stateOf(actor.id);
  const { error } = await db.from("account_regions").upsert({ account_id: actor.id, state_code: body.state, set_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw new Error(`state save failed: ${error.message}`);
  return {
    ok: true, body: { state: body.state },
    // The state itself isn't written to the audit log (it's private); only that it was set or changed.
    event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: before ? "set" : "not set", next: "set", context: before ? "Changed their state (private; not recorded here)." : "Gave their state (private; not recorded here)." },
  };
}

// ============ The Owner's allow-list ============

export async function allowList() {
  const rows = ((await getDb().from("mission_state_allowlist").select("mission_type, state_code, teens_allowed")).data ?? []) as { mission_type: string; state_code: string; teens_allowed: boolean }[];
  return {
    types: Object.entries(MISSION_TYPES).map(([key, t]) => ({ key, label: t.label, contacts: t.contacts, allowedStates: rows.filter((r) => r.mission_type === key && r.teens_allowed).map((r) => r.state_code).sort() })),
    states: Object.entries(US_STATES).map(([code, name]) => ({ code, name })),
    limits: TEEN_MISSION_LIMITS,
    note: "Off for teens in every state until you turn a mission type on for a state. Decide with your lawyer. Adults don't need this.",
  };
}

/** The Owner turns a mission type on or off for teens in a state. Body: { missionType, state, teensAllowed }. Audited with a reason. */
export async function setAllowList(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "missions.allowlist";
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner sets where teens may do real-world missions.", A);
  if (!isMissionType(body.missionType)) return refused(400, "Choose a kind of mission.", A);
  if (!isStateCode(body.state)) return refused(400, "Choose a state.", A);
  if (typeof body.teensAllowed !== "boolean") return refused(400, "Turn it on or off.", A);
  const target = { type: "mission_type", id: body.missionType, label: `${MISSION_TYPES[body.missionType].label} in ${US_STATES[body.state]}` };
  const db = getDb();
  const before = ((await db.from("mission_state_allowlist").select("teens_allowed").eq("mission_type", body.missionType).eq("state_code", body.state).maybeSingle()).data as { teens_allowed: boolean } | null)?.teens_allowed ?? false;
  const { error } = await db.from("mission_state_allowlist").upsert({ mission_type: body.missionType, state_code: body.state, teens_allowed: body.teensAllowed, updated_by_account_id: actor.id }, { onConflict: "mission_type,state_code" });
  if (error) throw new Error(`allow-list save failed: ${error.message}`);
  return {
    ok: true, body: await allowList(),
    event: { action: A, result: "Completed", target, previous: before ? "on for teens" : "off for teens", next: body.teensAllowed ? "on for teens" : "off for teens", context: `${body.teensAllowed ? "Turned on" : "Turned off"} "${MISSION_TYPES[body.missionType].label}" for teens in ${US_STATES[body.state]}.` },
  };
}

// ============ Guardian approvals ============

async function guardianOf(teenId: string): Promise<string | null> {
  const rows = ((await getDb().from("guardian_relationships").select("guardian_account_id, verification_status, authorized_at, withdrawn_at").eq("teen_account_id", teenId)).data ?? []) as
    { guardian_account_id: string; verification_status: string; authorized_at: string | null; withdrawn_at: string | null }[];
  return rows.find((r) => r.verification_status === "verified" && r.authorized_at && !r.withdrawn_at)?.guardian_account_id ?? null;
}

/** A teen asks their Guardian: for missions in a course (scope "course"), or for one contact mission (scope "contact"). Body: { itemId, scope }. */
export async function requestApproval(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "missions.request";
  if (!actor.isMinor) return refused(409, "Adults don't need a Guardian's approval for missions.", A);
  if (!isUuid(body.itemId) || (body.scope !== "course" && body.scope !== "contact")) return refused(400, "Choose the mission.", A);
  const db = getDb();
  const item = (await db.from("activity_items").select("id, course_id, mission_type, prompt, status").eq("id", body.itemId).maybeSingle()).data as
    { id: string; course_id: string; mission_type: string | null; prompt: string; status: string } | null;
  if (!item || item.status !== "published" || !isMissionType(item.mission_type)) return refused(404, "No such mission.", A);
  if (body.scope === "contact" && !MISSION_TYPES[item.mission_type].contacts) return refused(400, "This mission doesn't contact anyone.", A);
  const academy = ((await db.from("courses").select("academy_id").eq("id", item.course_id).maybeSingle()).data as { academy_id: string } | null)?.academy_id;
  const guardian = await guardianOf(actor.id);
  if (!academy || !guardian) return refused(409, "Your Guardian's account needs to be verified first.", A);
  const { error } = await db.from("mission_approvals").insert({
    teen_account_id: actor.id, guardian_account_id: guardian, academy_id: academy, scope: body.scope, item_id: body.scope === "contact" ? item.id : null,
  });
  if (error?.code === "23505") return refused(409, "You've already asked; your Guardian sees it in their Guardian Center.", A);
  if (error) throw new Error(`mission request failed: ${error.message}`);
  return {
    ok: true, status: 201, body: { requested: true },
    event: { action: A, result: "Completed", target: { type: "activity_item", id: item.id, label: item.prompt.slice(0, 80) }, previous: "none", next: "requested", context: `Asked their Guardian to approve ${body.scope === "course" ? "real-world missions in this course" : "one mission that contacts someone"}.` },
  };
}

/** The Guardian's open requests, for each of their teens. */
export async function guardianRequests(actor: Account) {
  const db = getDb();
  const rows = ((await db.from("mission_approvals").select("id, teen_account_id, academy_id, item_id, scope, status, requested_at").eq("guardian_account_id", actor.id)).data ?? []) as
    { id: string; teen_account_id: string; academy_id: string; item_id: string | null; scope: string; status: string; requested_at: string }[];
  const out = [];
  for (const r of rows.filter((x) => x.status === "requested").sort((a, b) => a.requested_at.localeCompare(b.requested_at))) {
    const academy = (await db.from("academies").select("name").eq("id", r.academy_id).maybeSingle()).data as { name: string } | null;
    const item = r.item_id ? ((await db.from("activity_items").select("prompt, mission_type").eq("id", r.item_id).maybeSingle()).data as { prompt: string; mission_type: string } | null) : null;
    const teen = (await db.from("profiles").select("display_name").eq("account_id", r.teen_account_id).maybeSingle()).data as { display_name: string } | null;
    out.push({
      id: r.id, teen: teen?.display_name?.split(" ")[0] ?? "Your teen", course: academy?.name ?? "a course", scope: r.scope, requestedAt: r.requested_at,
      mission: item ? { prompt: item.prompt, kind: isMissionType(item.mission_type) ? MISSION_TYPES[item.mission_type].label : item.mission_type } : null,
    });
  }
  return { requests: out, limits: TEEN_MISSION_LIMITS };
}

/** The Guardian approves or declines. Body: { decision: "approve" | "decline" }. Audited. */
export async function decideApproval(actor: Account, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "missions.decide";
  if (!isUuid(id)) return refused(404, "No such request.", A);
  if (body.decision !== "approve" && body.decision !== "decline") return refused(400, "Approve or decline.", A);
  const db = getDb();
  const r = (await db.from("mission_approvals").select("id, guardian_account_id, teen_account_id, scope, status").eq("id", id).maybeSingle()).data as
    { id: string; guardian_account_id: string; teen_account_id: string; scope: string; status: string } | null;
  if (!r || r.guardian_account_id !== actor.id) return refused(404, "No such request.", A);
  if (r.status !== "requested") return refused(409, `This request is already ${r.status}.`, A);
  // The Guardian must still be the teen's verified Guardian.
  if ((await guardianOf(r.teen_account_id)) !== actor.id) return refused(403, "You're not this teen's verified Guardian.", A);
  const status = body.decision === "approve" ? "approved" : "declined";
  const { error } = await db.from("mission_approvals").update({ status, decided_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`mission decision failed: ${error.message}`);
  return {
    ok: true, body: await guardianRequests(actor),
    event: { action: A, result: "Completed", target: { type: "account", id: r.teen_account_id }, previous: "requested", next: status, context: `The Guardian ${status} ${r.scope === "course" ? "real-world missions for a course" : "one mission that contacts someone"}.` },
  };
}
