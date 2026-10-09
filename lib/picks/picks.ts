import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { tierOf } from "@/lib/billing";
import { ATTORNEY, NO_ATTORNEY, clean, isUuid, refused, type Result } from "@/lib/courses/common";
import { courseStatuses, queueTopics } from "@/lib/catalog";
import { topicEstimate } from "@/lib/ai/config";
import {
  QUESTIONS, SKILL_LIMIT_BASIC, checkPathAnswers, pickPlanOf, rankBusinesses, skillLimitOf, visibleTo,
  type Kind, type PathAnswers, type PickPlan,
} from "./rules";

/**
 * L8: pick your path.
 *   - Five short questions, saved on the learner's profile (fixed lists only). Private to the learner: only that they
 *     answered is audited, never the answers.
 *   - Businesses (5 best matches first) and skills. Every limit is enforced by the database functions in
 *     0019_topics_and_picks.sql, in one transaction per learner; this file maps their results to plain words.
 *   - Teens never see or pick a teen_hidden topic (checked here and again by the database).
 *   - Admin: the Owner and authorized staff manage topics; the Owner alone changes or releases a learner's business,
 *     with a reason. Every change is audited.
 * No income, earnings or results are promised anywhere: NO_PROMISE is shown on every screen that lists topics.
 */
export const NO_PROMISE = "Results vary. Nothing here promises income.";
export const LOCK_NOTE = "Only the Owner can change this.";

type TopicDb = { id: string; kind: Kind; slug: string; name: string; blurb: string; published: boolean; teen_hidden: boolean; has_course: boolean; sort_order: number; catalog_slug: string | null };
type PickDb = { id: string; user_id: string; topic_id: string; kind: Kind; status: "active" | "paused"; locked: boolean; picked_at: string };
type ProfileDb = { path_goal: string | null; path_hours: number | null; path_experience: string | null; path_style: string | null; path_camera: string | null; path_answered_at: string | null };

const TOPIC_COLS = "id, kind, slug, name, blurb, published, teen_hidden, has_course, sort_order, catalog_slug";

async function allTopics(): Promise<TopicDb[]> {
  const { data, error } = await getDb().from("topics").select(TOPIC_COLS).order("sort_order", { ascending: true });
  if (error) throw new Error(`topics read failed: ${error.message}`);
  return (data ?? []) as TopicDb[];
}
async function picksOf(accountId: string): Promise<PickDb[]> {
  const { data, error } = await getDb().from("learner_picks").select("id, user_id, topic_id, kind, status, locked, picked_at").eq("user_id", accountId);
  if (error) throw new Error(`picks read failed: ${error.message}`);
  return (data ?? []) as PickDb[];
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getDb().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

export const planFor = async (actor: Pick<Account, "id" | "roleKey">): Promise<PickPlan | null> => pickPlanOf((await tierOf(actor)).tier);
/**
 * R1: the limits that apply to picks. The interview comes before the plan step, so a learner with no plan yet gets the
 * Basic and trial limits (up to 3 skills, 1 business that locks); once they choose a plan, that plan's rules apply.
 */
export const limitsFor = async (actor: Pick<Account, "id" | "roleKey">): Promise<PickPlan> => (await planFor(actor)) ?? "trial";
export const NO_PLAN_NOTE = "Until you choose a plan: up to 3 skills (you can swap them) and 1 business, the Basic and free-trial limits. Once chosen, your business is locked; only the Owner can change it.";

async function answersOf(accountId: string): Promise<PathAnswers | null> {
  const p = (await getDb().from("profiles").select("path_goal, path_hours, path_experience, path_style, path_camera, path_answered_at").eq("account_id", accountId).maybeSingle()).data as ProfileDb | null;
  if (!p?.path_answered_at) return null;
  const c = checkPathAnswers({ goal: p.path_goal, hours: p.path_hours, experience: p.path_experience, style: p.path_style, camera: p.path_camera });
  return "answers" in c ? c.answers : null;
}

/** C1: a topic linked to a published course opens it (its first lesson); otherwise it shows "Course coming". */
const topicView = (t: TopicDb, links: Map<string, { status: string; firstLessonId: string | null }> = new Map()) => {
  const c = t.catalog_slug ? links.get(t.catalog_slug) : undefined;
  const href = t.has_course && c?.status === "published" && c.firstLessonId ? `/learn/${c.firstLessonId}` : null;
  return { slug: t.slug, name: t.name, blurb: t.blurb, hasCourse: t.has_course, courseHref: href, sortOrder: t.sort_order };
};

/** Everything the "Choose your path" screens show, after bringing the picks in line with the plan. */
export async function getChooser(actor: Account) {
  const plan = await planFor(actor);
  const limits = plan ?? "trial";
  // A plan change (e.g. Pro to Basic) is applied here, by the database: extra skills paused, the business locked.
  await rpc<number>("reconcile_picks", { p_account: actor.id, p_plan: limits });
  const [topics, picks, answers] = await Promise.all([allTopics(), picksOf(actor.id), answersOf(actor.id)]);
  const visible = topics.filter((t) => visibleTo(t, actor.isMinor));
  const links = await courseStatuses(visible.map((t) => t.catalog_slug).filter((x): x is string => !!x));
  const pickOf = (id: string) => picks.find((p) => p.topic_id === id) ?? null;
  const state = (t: TopicDb) => {
    const p = pickOf(t.id);
    return { picked: p?.status === "active", paused: p?.status === "paused", locked: !!p?.locked };
  };
  const businesses = rankBusinesses(visible.filter((t) => t.kind === "business").map((t) => ({ ...topicView(t, links), ...state(t) })), answers);
  const skills = visible.filter((t) => t.kind === "skill").map((t) => ({ ...topicView(t, links), ...state(t) }));
  const business = businesses.find((b) => b.picked) ?? null;
  const skillsUsed = skills.filter((s) => s.picked).length;
  const limit = skillLimitOf(limits);
  return {
    plan, questions: QUESTIONS, answers, businesses, skills,
    business: business ? { slug: business.slug, name: business.name, locked: business.locked, lockNote: business.locked ? LOCK_NOTE : null } : null,
    skillsUsed, skillLimit: limit,
    skillCounter: limit === null ? `${skillsUsed} skill${skillsUsed === 1 ? "" : "s"} chosen (no limit on Pro)` : `${skillsUsed} of ${limit} skills used`,
    note: NO_PROMISE,
    planNote: !plan ? NO_PLAN_NOTE
      : plan === "pro" ? "Pro: as many skills as you like, and one business at a time. You can switch business; your progress is kept."
        : `${plan === "trial" ? "Free trial" : "Basic"}: up to ${SKILL_LIMIT_BASIC} skills (you can swap them) and 1 business. Once chosen, your business is locked; only the Owner can change it.`,
  };
}

/** Saves the five answers on the profile. Body: { goal, hours, experience, style, camera }. */
export async function saveAnswers(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.path_answers.save";
  const c = checkPathAnswers(body);
  if ("problem" in c) return refused(400, c.problem, A);
  const before = await answersOf(actor.id);
  const a = c.answers;
  const { error } = await getDb().from("profiles").update({
    path_goal: a.goal, path_hours: a.hours, path_experience: a.experience, path_style: a.style, path_camera: a.camera, path_answered_at: new Date().toISOString(),
  }).eq("account_id", actor.id);
  if (error) throw new Error(`answers save failed: ${error.message}`);
  return {
    ok: true, body: await getChooser(actor),
    event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: before ? "answered" : "not answered", next: "answered", context: `${before ? "Changed" : "Answered"} the five "Choose your path" questions (answers private; not recorded here).` },
  };
}

async function topicBySlug(slug: unknown): Promise<TopicDb | null> {
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) return null;
  return (await getDb().from("topics").select(TOPIC_COLS).eq("slug", slug).maybeSingle()).data as TopicDb | null;
}

const NOT_AVAILABLE = "That topic isn't available.";

/** Body: { slug }. Picks a business or a skill; the database applies the plan's limits atomically. */
export async function pick(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.picks.pick";
  const plan = await limitsFor(actor);
  const t = await topicBySlug(body.slug);
  // Teens never see a teen_hidden topic: the same answer as for one that doesn't exist.
  if (!t || !visibleTo(t, actor.isMinor)) return refused(404, NOT_AVAILABLE, A);
  const target = { type: "topic", id: t.id, label: t.name };
  const r = await rpc<{ result: string; used?: number; limit?: number; previous?: string | null }>("pick_topic", { p_account: actor.id, p_topic: t.id, p_plan: plan });
  if (r.result === "not_available" || r.result === "no_account") return refused(404, NOT_AVAILABLE, A, target);
  if (r.result === "limit") return refused(409, `You're using ${r.used} of ${r.limit} skills. Set one aside to pick another, or Pro allows more.`, A, target);
  if (r.result === "locked") return refused(403, `Your business is locked. ${LOCK_NOTE}`, A, target);
  if (r.result === "already") return { ok: true, body: await getChooser(actor), event: { action: A, result: "Completed", target, previous: "picked", next: "picked", context: `Already picked: ${t.name}.` } };
  const prev = r.previous ? (await getDb().from("topics").select("name").eq("id", r.previous).maybeSingle()).data as { name: string } | null : null;
  return {
    ok: true, status: 201, body: await getChooser(actor),
    event: {
      action: A, result: "Completed", target, previous: prev ? `business: ${prev.name} (now paused, kept)` : "not picked", next: `${t.kind}: ${t.name}${t.kind === "business" && plan !== "pro" ? " (locked)" : ""}`,
      context: `Picked the ${t.kind} "${t.name}" on ${plan === "pro" ? "Pro" : plan === "trial" ? "the free trial" : "Basic"}.${t.has_course ? "" : " No course yet: counted as anonymous demand."}`,
    },
  };
}

/** Body: { slug }. Sets a pick aside (paused, kept). A locked business can't be set aside. */
export async function pause(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "learn.picks.pause";
  const plan = await limitsFor(actor);
  const t = await topicBySlug(body.slug);
  if (!t) return refused(404, "That isn't one of your picks.", A);
  const target = { type: "topic", id: t.id, label: t.name };
  const r = await rpc<{ result: string }>("pause_pick", { p_account: actor.id, p_topic: t.id, p_plan: plan });
  if (r.result === "not_picked") return refused(404, "That isn't one of your picks.", A, target);
  if (r.result === "locked") return refused(403, `Your business is locked. ${LOCK_NOTE}`, A, target);
  return { ok: true, body: await getChooser(actor), event: { action: A, result: "Completed", target, previous: "picked", next: "set aside (kept)", context: `Set aside the ${t.kind} "${t.name}".` } };
}

// ============ Admin: topics ============

/** Every topic with its anonymous demand (last 30 days and all time) and how many learners have it active. */
export async function listTopicsAdmin() {
  const db = getDb();
  const topics = await allTopics();
  const interest = ((await db.from("topic_interest").select("topic_id, day, count")).data ?? []) as { topic_id: string; day: string; count: number }[];
  const active = ((await db.from("learner_picks").select("topic_id").eq("status", "active")).data ?? []) as { topic_id: string }[];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const links = await courseStatuses(topics.map((t) => t.catalog_slug).filter((x): x is string => !!x));
  return {
    topics: topics.map((t) => ({
      id: t.id, kind: t.kind, slug: t.slug, name: t.name, blurb: t.blurb, published: t.published, teenHidden: t.teen_hidden, hasCourse: t.has_course, sortOrder: t.sort_order,
      // C1: the one link to the catalog, and the course's status (none, drafting, in review, published).
      catalogSlug: t.catalog_slug, course: t.catalog_slug ? links.get(t.catalog_slug) ?? { status: "none", label: "None", firstLessonId: null } : { status: "none", label: "None", firstLessonId: null },
      demand30: interest.filter((i) => i.topic_id === t.id && i.day >= since).reduce((n, i) => n + i.count, 0),
      demandAll: interest.filter((i) => i.topic_id === t.id).reduce((n, i) => n + i.count, 0),
      activePicks: active.filter((p) => p.topic_id === t.id).length,
    })),
    note: "Demand counts are anonymous: how many times a topic with no course was picked, per day. They never say who.",
  };
}

const NO_PROMISE_RX = /\$\s?\d|\b(guarantee[sd]?|passive income|get rich|six[- ]figure|make money fast|earn (up to|\$)|income (guaranteed|of))\b/i;
function checkTopicText(name: string, blurb: string): string | null {
  if (name.length < 2) return "Give the topic a name.";
  if (ATTORNEY.test(`${name} ${blurb}`)) return NO_ATTORNEY;
  if (NO_PROMISE_RX.test(`${name} ${blurb}`)) return "Topics never promise income, earnings or results. Reword it.";
  return null;
}
const slugOf = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Body: { kind, name, blurb?, slug?, published?, teenHidden?, hasCourse? }. New topics start unpublished unless set. */
export async function createTopic(body: Record<string, unknown>): Promise<Result> {
  const A = "topics.manage";
  if (body.kind !== "business" && body.kind !== "skill") return refused(400, "Choose business or skill.", A);
  const name = clean(body.name, 80), blurb = clean(body.blurb, 300);
  const problem = checkTopicText(name, blurb);
  if (problem) return refused(400, problem, A);
  const slug = slugOf(typeof body.slug === "string" && body.slug ? body.slug : name);
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) return refused(400, "Give the topic a short name (letters and numbers).", A);
  const db = getDb();
  if ((await db.from("topics").select("id").eq("slug", slug).maybeSingle()).data) return refused(409, "A topic with that name already exists.", A);
  const last = ((await db.from("topics").select("sort_order").eq("kind", body.kind).order("sort_order", { ascending: false }).limit(1)).data ?? []) as { sort_order: number }[];
  const row = { kind: body.kind, slug, name, blurb, published: body.published === true, teen_hidden: body.teenHidden === true, has_course: body.hasCourse === true, sort_order: (last[0]?.sort_order ?? 0) + 10 };
  const { data, error } = await db.from("topics").insert(row).select("id").single();
  if (error) throw new Error(`topic insert failed: ${error.message}`);
  const id = (data as { id: string }).id;
  return {
    ok: true, status: 201, body: await listTopicsAdmin(),
    event: { action: A, result: "Completed", target: { type: "topic", id, label: name }, previous: null, next: describe(row), context: `Added the ${body.kind} "${name}".` },
  };
}

const describe = (t: { published: boolean; teen_hidden: boolean; has_course: boolean }) =>
  `${t.published ? "published" : "unpublished"}, ${t.teen_hidden ? "hidden from teens" : "shown to teens"}, ${t.has_course ? "has a course" : "course coming"}`;

/** Body: any of { name, blurb, published, teenHidden, hasCourse }. The kind and slug never change (picks rely on them). */
export async function updateTopic(id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "topics.manage";
  if (!isUuid(id)) return refused(404, "No such topic.", A);
  const db = getDb();
  const row = (await db.from("topics").select(TOPIC_COLS).eq("id", id).maybeSingle()).data as TopicDb | null;
  if (!row) return refused(404, "No such topic.", A);
  const t = { ...row }; // as it was, before the update
  const target = { type: "topic", id, label: t.name };
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) fields.name = clean(body.name, 80);
  if (body.blurb !== undefined) fields.blurb = clean(body.blurb, 300);
  if (body.hasCourse !== undefined && t.catalog_slug) return refused(409, "This topic is linked to a course: it shows the course when the course is published, and \"Course coming\" otherwise.", A, target);
  for (const [k, col] of [["published", "published"], ["teenHidden", "teen_hidden"], ["hasCourse", "has_course"]] as const) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "boolean") return refused(400, "Use true or false.", A, target);
      fields[col] = body[k];
    }
  }
  if (!Object.keys(fields).length) return refused(400, "Nothing to change.", A, target);
  const problem = checkTopicText(String(fields.name ?? t.name), String(fields.blurb ?? t.blurb));
  if (problem) return refused(400, problem, A, target);
  const { error } = await db.from("topics").update(fields).eq("id", id);
  if (error) throw new Error(`topic update failed: ${error.message}`);
  const after = { ...t, ...fields } as TopicDb;
  const changes = [
    after.name !== t.name ? `name "${t.name}" → "${after.name}"` : null, after.blurb !== t.blurb ? "description edited" : null,
    after.published !== t.published ? (after.published ? "published" : "unpublished") : null,
    after.teen_hidden !== t.teen_hidden ? (after.teen_hidden ? "hidden from teens" : "shown to teens") : null,
    after.has_course !== t.has_course ? (after.has_course ? "has a course" : "course coming") : null,
  ].filter(Boolean);
  return {
    ok: true, body: await listTopicsAdmin(),
    event: { action: A, result: "Completed", target, previous: describe(t), next: describe(after), context: `Edited the ${t.kind} "${after.name}": ${changes.join("; ") || "no change"}.` },
  };
}

/** Body: { kind, order: [slug, ...] } with every topic of that kind. */
export async function reorderTopics(body: Record<string, unknown>): Promise<Result> {
  const A = "topics.manage";
  if (body.kind !== "business" && body.kind !== "skill") return refused(400, "Choose business or skill.", A);
  const topics = (await allTopics()).filter((t) => t.kind === body.kind);
  const order = Array.isArray(body.order) ? body.order : [];
  if (order.length !== topics.length || !topics.every((t) => order.includes(t.slug))) return refused(400, `Send every ${body.kind} topic, in the new order.`, A);
  const db = getDb();
  for (const t of topics) {
    const sort = (order.indexOf(t.slug) + 1) * 10;
    if (sort === t.sort_order) continue;
    const { error } = await db.from("topics").update({ sort_order: sort }).eq("id", t.id);
    if (error) throw new Error(`topic reorder failed: ${error.message}`);
  }
  return {
    ok: true, body: await listTopicsAdmin(),
    event: { action: A, result: "Completed", target: { type: "topics", id: String(body.kind) }, previous: topics.map((t) => t.slug).join(", ").slice(0, 500), next: order.join(", ").slice(0, 500), context: `Reordered the ${body.kind} topics.` },
  };
}

// ============ The Owner: a learner's business ============

async function learnerByEmail(email: unknown) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  return (await getDb().from("accounts").select("id, email, role, is_minor, status").ilike("email", email.trim()).maybeSingle()).data as
    { id: string; email: string; role: string; is_minor: boolean; status: string } | null;
}

/** The Owner looks up a learner's picks by email (what they picked, and the business lock). */
export async function lookupLearner(email: string | null) {
  const a = await learnerByEmail(email);
  if (!a || a.role !== "learner") return { found: false as const };
  const plan = await planFor({ id: a.id, roleKey: "learner" });
  await rpc<number>("reconcile_picks", { p_account: a.id, p_plan: plan ?? "trial" });
  const [topics, picks] = await Promise.all([allTopics(), picksOf(a.id)]);
  const name = (id: string) => topics.find((t) => t.id === id);
  return {
    found: true as const, accountId: a.id, email: a.email, teen: a.is_minor === true, plan,
    picks: picks.map((p) => ({ slug: name(p.topic_id)?.slug ?? "", name: name(p.topic_id)?.name ?? "(removed)", kind: p.kind, status: p.status, locked: p.locked, pickedAt: p.picked_at }))
      .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "business" ? -1 : 1) || (x.status === y.status ? 0 : x.status === "active" ? -1 : 1)),
    businesses: topics.filter((t) => t.kind === "business" && visibleTo(t, a.is_minor)).map((t) => ({ slug: t.slug, name: t.name })),
  };
}

/** Body: { accountId, slug | null }. The Owner changes a learner's business, or releases it (slug null). Reason required. */
export async function ownerSetBusiness(body: Record<string, unknown>): Promise<Result> {
  const A = "picks.override";
  if (!isUuid(body.accountId)) return refused(400, "Choose a learner.", A);
  const db = getDb();
  const a = (await db.from("accounts").select("id, email, role, is_minor").eq("id", body.accountId).maybeSingle()).data as { id: string; email: string; role: string; is_minor: boolean } | null;
  if (!a || a.role !== "learner") return refused(404, "No such learner.", A);
  const target = { type: "account", id: a.id, label: a.email };
  const plan = await limitsFor({ id: a.id, roleKey: "learner" });
  let topicId: string | null = null;
  let topicName = "none (the learner may choose again)";
  if (body.slug !== null) {
    const t = await topicBySlug(body.slug);
    if (!t || t.kind !== "business" || !visibleTo(t, a.is_minor)) return refused(404, a.is_minor ? "That business isn't available to this learner (teens can't have it)." : "That business isn't available.", A, target);
    topicId = t.id; topicName = t.name;
  }
  const r = await rpc<{ result: string; previous: string | null }>("owner_set_business", { p_account: a.id, p_topic: topicId, p_plan: plan });
  if (r.result === "not_available") return refused(404, "That business isn't available to this learner.", A, target);
  if (r.result === "unchanged") return refused(409, "Nothing to change: that is already the learner's business.", A, target);
  const prev = r.previous ? (await db.from("topics").select("name").eq("id", r.previous).maybeSingle()).data as { name: string } | null : null;
  return {
    ok: true, body: await lookupLearner(a.email),
    event: {
      action: A, result: "Completed", target, previous: prev ? `${prev.name} (now paused, kept)` : "no business", next: r.result === "released" ? "released: the learner may choose again" : `${topicName}${plan === "pro" ? "" : " (locked)"}`,
      context: r.result === "released" ? "The Owner released the learner's business so they can choose again." : `The Owner changed the learner's business to "${topicName}".`,
    },
  };
}

/**
 * C1: the Owner (or a Course Admin) starts a topic's course from /admin/topics. The topic is linked to the catalog (one
 * link: topics.catalog_slug) and queued for the existing steps (research, Blueprint, drafting) as a v2 course: 5 or 6
 * modules with recipes, video briefs and the Owner's review. Body: { confirm?: true, expectedTotalUsd? }: first the
 * estimate, then the same total confirmed. Until the course is published the topic shows "Course coming".
 */
export async function startTopicCourse(actor: Account, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "catalog.queue";
  if (actor.roleKey !== "owner" && actor.roleKey !== "courseAdmin") return refused(403, "Only the Owner or a Course Admin starts a course.", A);
  if (!isUuid(id)) return refused(404, "No such topic.", A);
  const db = getDb();
  const t = (await db.from("topics").select(TOPIC_COLS).eq("id", id).maybeSingle()).data as TopicDb | null;
  if (!t) return refused(404, "No such topic.", A);
  const target = { type: "topic", id, label: t.name };
  const slug = t.catalog_slug ?? (t.slug.slice(0, 40).replace(/-+$/, "") || "topic");
  const existing = (await db.from("catalog_topics").select("slug").eq("slug", slug).maybeSingle()).data as { slug: string } | null;
  if (!t.catalog_slug && existing) {
    const other = (await db.from("topics").select("name").eq("catalog_slug", slug).maybeSingle()).data as { name: string } | null;
    if (other) return refused(409, `The catalog topic "${slug}" is already linked to "${other.name}".`, A, target);
  }
  if (body.confirm !== true && !existing) {
    const per = Math.round(topicEstimate() * 100) / 100;
    return { ok: true, body: { quote: { topics: [{ slug, name: t.name, estimateUsd: per }], totalUsd: per, note: "Runs overnight inside the AI spend caps, and stops whenever a person is needed: source approval, Blueprint approval, review, then your approval of each module." } }, event: { action: A, result: "Completed", context: "" } };
  }
  if (!existing) {
    const ins = await db.from("catalog_topics").insert({ slug, name: t.name, outcome: t.blurb || null, audience_level: "beginner", origin: "owner" });
    if (ins.error && ins.error.code !== "23505") throw new Error(`catalog topic insert failed: ${ins.error.message}`);
  }
  if (!t.catalog_slug) {
    const { error } = await db.from("topics").update({ catalog_slug: slug }).eq("id", id);
    if (error) throw new Error(`topic link failed: ${error.message}`);
  }
  const r = await queueTopics(actor, { slugs: [slug], confirm: body.confirm === true, expectedTotalUsd: body.expectedTotalUsd, structure: 2 });
  if (!r.ok || body.confirm !== true) return r;
  return {
    ...r,
    event: { ...r.event, target, previous: t.catalog_slug ? `linked to ${slug}` : "not linked", next: `linked to ${slug}; course queued`, context: `Started the course for the ${t.kind} "${t.name}": linked to the catalog topic "${slug}" and queued (5 or 6 modules with recipes, video briefs and the Owner's review). ${r.event.context}` },
  };
}
