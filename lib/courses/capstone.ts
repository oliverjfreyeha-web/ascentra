import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ATTORNEY, NO_ATTORNEY, clean, courseScope, isUuid, refused, type Result } from "./common";
import { findIncomeClaims, textsOf } from "./income";
import { academyOf } from "./owner-review";
import { courseState, recordCapstone } from "@/lib/progress/progress";

/**
 * C2: every course has a required capstone, and two optional once-per-course notices.
 *   The capstone: a title, a brief, deliverables, and a self-check checklist. A course is "Course complete" only when
 *   every module is done and the capstone is done (every deliverable and check ticked by the learner).
 *   A business course's capstone also has "Automation with AI": what gets automated, master prompts (written by the
 *   Owner by hand), and the AI plan note: the top 3 AI plans by value for agents and automation, each with a price, a
 *   source link and a "checked on" date, entered by the Owner and watched for freshness (C3 alerts when it goes stale).
 *   Without the Owner's list, the page says "A paid plan may be needed" and recommends no plan. Nothing is invented.
 *   The notices: a business license notice and a software or AI plan notice, general information only, no legal or
 *   income claims, each shown once per course.
 * Edited only on a Draft course version, like everything else; every change is audited.
 */

export type Plan = { name: string; price: string; sourceUrl: string; checkedOn: string };
export type Automation = { what: string; prompts: string[]; plans: Plan[] };
export const PAID_PLAN_NOTE = "A paid plan may be needed for some of these tools. ASCENTRA doesn't recommend a specific plan here.";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v <= new Date().toISOString().slice(0, 10);
const list = (v: unknown, n: number, each: number) => (Array.isArray(v) ? v.map((x) => clean(x, each)).filter(Boolean).slice(0, n) : []);

/** Pure: checks the Owner's capstone. Returns the row to save, or a problem. Tested in tests/unit/capstone.test.ts. */
export function checkCapstone(body: Record<string, unknown>, business: boolean): { row: { title: string; brief: string; deliverables: string[]; checklist: string[]; automation: Automation | null; plans_checked_on: string | null } } | { problem: string } {
  const title = clean(body.title, 200);
  if (title.length < 3) return { problem: "Give the capstone a title." };
  const deliverables = list(body.deliverables, 12, 300);
  const checklist = list(body.checklist, 20, 300);
  if (!deliverables.length) return { problem: "List at least one deliverable." };
  if (!checklist.length) return { problem: "List at least one self-check item." };
  let automation: Automation | null = null;
  let checkedOn: string | null = null;
  const a = body.automation && typeof body.automation === "object" ? (body.automation as Record<string, unknown>) : null;
  if (business && !a) return { problem: "A business course's capstone includes \"Automation with AI\": say what gets automated." };
  if (a) {
    const what = clean(a.what, 1000);
    if (business && what.length < 10) return { problem: "Say what gets automated (\"Automation with AI\")." };
    const prompts = Array.isArray(a.prompts) ? a.prompts.map((p) => (typeof p === "string" ? p.trim().slice(0, 4000) : "")).filter(Boolean).slice(0, 12) : [];
    const plans: Plan[] = [];
    for (const p of Array.isArray(a.plans) ? a.plans.slice(0, 3) : []) {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const plan = { name: clean(o.name, 80), price: clean(o.price, 60), sourceUrl: clean(o.sourceUrl, 500), checkedOn: typeof o.checkedOn === "string" ? o.checkedOn : "" };
      if (!plan.name || !plan.price || !/^https:\/\/\S+$/.test(plan.sourceUrl) || !isDay(plan.checkedOn)) {
        return { problem: "Each AI plan needs a name, a price, an https source link and the date you checked it." };
      }
      plans.push(plan);
    }
    automation = { what, prompts, plans };
    checkedOn = plans.length ? plans.map((p) => p.checkedOn).sort()[0] : null;
  }
  const row = { title, brief: clean(body.brief, 2000), deliverables, checklist, automation, plans_checked_on: checkedOn };
  const text = textsOf(row).join(" \n ");
  if (ATTORNEY.test(text)) return { problem: NO_ATTORNEY };
  const claim = findIncomeClaims(text)[0];
  if (claim) return { problem: `This reads as ${claim.claim}: "${claim.text}". Capstones never promise income or results. Reword it.` };
  return { row };
}

async function draftOf(actor: Account, slug: string, A: string) {
  const scope = courseScope(actor, "courses.edit", slug);
  const academy = await academyOf(slug);
  if (!academy) return { r: refused(404, "No such course.", A) };
  const target = { type: "course", id: slug, label: academy.name };
  if (scope) return { r: refused(403, scope, A, target) };
  const course = (((await getDb().from("courses").select("id, version, status").eq("academy_id", academy.id)).data ?? []) as { id: string; version: number; status: string }[]).sort((a, b) => b.version - a.version)[0];
  if (!course) return { r: refused(404, "This course has no version yet.", A, target) };
  if (course.status !== "draft") return { r: refused(409, `Version ${course.version} is live. Start a new version to edit it.`, A, target) };
  const topic = (await getDb().from("topics").select("kind").eq("catalog_slug", slug).maybeSingle()).data as { kind: string } | null;
  return { course, academy, target, business: topic?.kind === "business" };
}

/** The Owner (or a course builder) sets the capstone of a Draft version. */
export async function setCapstone(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.capstone.edit";
  const d = await draftOf(actor, slug, A);
  if ("r" in d) return d.r!;
  const c = checkCapstone(body, d.business);
  if ("problem" in c) return refused(400, c.problem, A, d.target);
  const db = getDb();
  const before = (await db.from("course_capstones").select("id, title").eq("course_id", d.course.id).maybeSingle()).data as { id: string; title: string } | null;
  const { error } = before
    ? await db.from("course_capstones").update(c.row).eq("id", before.id)
    : await db.from("course_capstones").insert({ course_id: d.course.id, ...c.row });
  if (error) throw new Error(`capstone save failed: ${error.message}`);
  return {
    ok: true, body: (await capstoneView(slug)) ?? {},
    event: { action: A, result: "Completed", target: d.target, previous: before ? before.title : "no capstone", next: c.row.title, context: `Set the capstone of "${d.academy.name}" v${d.course.version}: ${c.row.deliverables.length} deliverable(s), ${c.row.checklist.length} check(s)${c.row.automation ? `, Automation with AI with ${c.row.automation.plans.length} AI plan(s) entered` : ""}.` },
  };
}

/** Body: { license?, software? } (text, or null to remove). Each is shown once per course. */
export async function setNotices(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.notices.edit";
  const d = await draftOf(actor, slug, A);
  if ("r" in d) return d.r!;
  const fields: Record<string, string | null> = {};
  for (const [k, col] of [["license", "license_notice"], ["software", "software_notice"]] as const) {
    if (body[k] === undefined) continue;
    const t = body[k] === null ? null : clean(body[k], 600);
    if (t !== null && t.length < 10) return refused(400, "A notice needs at least a sentence (10 characters).", A, d.target);
    if (t && ATTORNEY.test(t)) return refused(400, NO_ATTORNEY, A, d.target);
    if (t && /\b(sponsor|affiliate link|promo code|use code)\b/i.test(t)) return refused(400, "Notices are general information, never sponsored.", A, d.target);
    const claim = t ? findIncomeClaims(t)[0] : null;
    if (claim) return refused(400, `This reads as ${claim.claim}: "${claim.text}". Reword it.`, A, d.target);
    fields[col] = t;
  }
  if (!Object.keys(fields).length) return refused(400, "Nothing to change.", A, d.target);
  const { error } = await getDb().from("courses").update(fields).eq("id", d.course.id);
  if (error) throw new Error(`notices save failed: ${error.message}`);
  return { ok: true, body: fields, event: { action: A, result: "Completed", target: d.target, previous: null, next: Object.keys(fields).join(", "), context: `Set the course notices (${Object.keys(fields).map((k) => k.replace("_notice", "")).join(", ")}) of "${d.academy.name}" v${d.course.version}.` } };
}

/** The capstone of the latest version, for the studio. */
export async function capstoneView(slug: string) {
  const academy = await academyOf(slug);
  if (!academy) return null;
  const db = getDb();
  const course = (((await db.from("courses").select("id, version, license_notice, software_notice").eq("academy_id", academy.id)).data ?? []) as { id: string; version: number; license_notice: string | null; software_notice: string | null }[]).sort((a, b) => b.version - a.version)[0];
  if (!course) return null;
  const c = (await db.from("course_capstones").select("title, brief, deliverables, checklist, automation, plans_checked_on, freshness_watch").eq("course_id", course.id).maybeSingle()).data as
    { title: string; brief: string; deliverables: string[]; checklist: string[]; automation: Automation | null; plans_checked_on: string | null; freshness_watch: boolean } | null;
  const topic = (await db.from("topics").select("kind").eq("catalog_slug", slug).maybeSingle()).data as { kind: string } | null;
  return {
    business: topic?.kind === "business",
    capstone: c ? { ...c, paidPlanNote: c.automation && !c.automation.plans.length ? PAID_PLAN_NOTE : null } : null,
    notices: { license: course.license_notice, software: course.software_notice },
  };
}

// ============ Learners ============

type LearnerCap = { id: string; account_id: string; course_capstone_id: string; checked: Record<string, boolean>; completed_at: string | null };

/** The learner's capstone for a course (the live version they study). */
export async function learnerCapstone(actor: Account, courseId: string) {
  if (!isUuid(courseId)) return null;
  const db = getDb();
  const c = (await db.from("course_capstones").select("id, course_id, title, brief, deliverables, checklist, automation").eq("course_id", courseId).maybeSingle()).data as
    { id: string; course_id: string; title: string; brief: string; deliverables: string[]; checklist: string[]; automation: Automation | null } | null;
  if (!c) return null;
  const mine = (await db.from("capstones").select("id, account_id, course_capstone_id, checked, completed_at").eq("account_id", actor.id).eq("course_capstone_id", c.id).maybeSingle()).data as LearnerCap | null;
  const st = await courseState(actor, courseId);
  return {
    id: c.id, title: c.title, brief: c.brief,
    deliverables: c.deliverables.map((t, i) => ({ key: `d${i}`, text: t, checked: !!mine?.checked?.[`d${i}`] })),
    checklist: c.checklist.map((t, i) => ({ key: `c${i}`, text: t, checked: !!mine?.checked?.[`c${i}`] })),
    automation: c.automation ? { what: c.automation.what, prompts: c.automation.prompts, plans: c.automation.plans, paidPlanNote: c.automation.plans.length ? null : PAID_PLAN_NOTE } : null,
    completedAt: mine?.completed_at ?? null,
    courseComplete: st?.complete ?? false,
    modulesDone: st ? st.modules.every((m) => m.done) : false,
  };
}

/** Body: { checked: { [key]: boolean } }. When every deliverable and check is ticked, the capstone is done. */
export async function checkLearnerCapstone(actor: Account, courseId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.capstone";
  const view = await learnerCapstone(actor, courseId);
  if (!view) return refused(404, "This course has no capstone.", A);
  const db = getDb();
  const academy = ((await db.from("courses").select("academy_id").eq("id", courseId).maybeSingle()).data as { academy_id: string } | null)?.academy_id;
  const keys = [...view.deliverables, ...view.checklist].map((x) => x.key);
  const given = body.checked && typeof body.checked === "object" ? (body.checked as Record<string, unknown>) : {};
  const checked = Object.fromEntries(keys.map((k) => [k, given[k] === true]));
  const all = keys.every((k) => checked[k]);
  const existing = (await db.from("capstones").select("id, completed_at").eq("account_id", actor.id).eq("course_capstone_id", view.id).maybeSingle()).data as { id: string; completed_at: string | null } | null;
  const completed_at = existing?.completed_at ?? (all ? new Date().toISOString() : null);
  const row = { checked, completed_at, status: completed_at ? "submitted" : "draft", submitted_at: completed_at };
  const { error } = existing
    ? await db.from("capstones").update(row).eq("id", existing.id)
    : await db.from("capstones").insert({ account_id: actor.id, academy_id: academy, title: view.title, course_capstone_id: view.id, ...row });
  if (error) throw new Error(`capstone save failed: ${error.message}`);
  if (completed_at) await recordCapstone(actor, view.id, courseId);
  return { ok: true, body: (await learnerCapstone(actor, courseId))!, event: { action: A, result: "Completed", context: "" } };
}
