/**
 * C2 against real Postgres behind PostgREST, through the real routes: a Standard course (5 modules, each with an
 * approved video and three practice items, all labelled) published for a learner on the trial. Module 1 is open and
 * module 2 locked with a reason; half of module 1 half-opens module 2; a quiz counts at 80% or more; a practice item is
 * marked done only after trying it; a "Very important" item adds its note to the Notebook; finishing modules 1 and 2
 * before day 14 earns half of module 3, which stays after converting to Basic. Then: the course notice shows once,
 * "My progress", the capstone, the leaderboard (an adult with a nickname; a teen sees only labelled practice rivals),
 * a teen's real-world mission with every Guardian step, the private state, a side-hustle pick, and the Owner's topic
 * facts with the income check. Test-only data: made-up titles and example.org sources.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie, trustedDeviceRow } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as attemptRoute from "@/app/api/v1/learn/activities/[id]/attempt/route";
import * as completeRoute from "@/app/api/v1/learn/activities/[id]/complete/route";
import * as watchedRoute from "@/app/api/v1/learn/videos/[id]/watched/route";
import * as progressRoute from "@/app/api/v1/learn/progress/route";
import * as notebookRoute from "@/app/api/v1/learn/notebook/route";
import * as ideasRoute from "@/app/api/v1/learn/notebook/ideas/route";
import * as ideaRoute from "@/app/api/v1/learn/notebook/ideas/[id]/route";
import * as aiRoute from "@/app/api/v1/learn/notebook/ai/route";
import * as summaryRoute from "@/app/api/v1/learn/notebook/summary/route";
import * as capstoneRoute from "@/app/api/v1/learn/capstones/[courseId]/route";
import * as boardRoute from "@/app/api/v1/leaderboard/route";
import * as nicknameRoute from "@/app/api/v1/leaderboard/nickname/route";
import * as visibilityRoute from "@/app/api/v1/leaderboard/visibility/route";
import * as moderationRoute from "@/app/api/v1/leaderboard/moderation/route";
import * as stateRoute from "@/app/api/v1/account/state/route";
import * as allowRoute from "@/app/api/v1/missions/allowlist/route";
import * as requestRoute from "@/app/api/v1/learn/missions/request/route";
import * as guardianRoute from "@/app/api/v1/guardian/missions/route";
import * as decideRoute from "@/app/api/v1/guardian/missions/[id]/route";
import * as picksRoute from "@/app/api/v1/learn/picks/route";
import * as topicRoute from "@/app/api/v1/topics/[id]/route";
import * as communityRoute from "@/app/api/v1/community/route";
import { RIVAL_LABEL } from "@/lib/leaderboard-rules";
import { aiConfigured } from "@/lib/ai";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
const SLUG = "seo-services";
let courseId = "";
let source = "";
let teenId = "";
type Mod = { id: string; lesson: string; video: string; quiz: string; assignment: string; sandbox: string };
const mods: Mod[] = [];

type Who = RoleKey | "teen";
async function call(mod: Record<string, unknown>, method: string, url: string, who: Who, body?: unknown, params: Record<string, string> = {}) {
  const id = who === "teen" ? teenId : ROLE_ID[who];
  session.userId = who === "teen" ? "user_int_c2teen" : clerkIdOf(who);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(id) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  const json = (await res.json()) as Record<string, unknown> & { reason?: string };
  return { status: res.status, body: json, reason: json.reason };
}
const lesson = (m: number, who: Who = "learner") => call(lessonRoute, "GET", `/api/v1/learn/lessons/${mods[m].lesson}`, who, undefined, { id: mods[m].lesson });
const attempt = (id: string, body: unknown = {}, who: Who = "learner") => call(attemptRoute, "POST", `/api/v1/learn/activities/${id}/attempt`, who, body, { id });
const complete = (id: string, who: Who = "learner") => call(completeRoute, "POST", `/api/v1/learn/activities/${id}/complete`, who, {}, { id });
const watched = (id: string, who: Who = "learner") => call(watchedRoute, "POST", `/api/v1/learn/videos/${id}/watched`, who, {}, { id });
const progress = async (who: Who = "learner") => (await call(progressRoute, "GET", "/api/v1/learn/progress", who)).body as unknown as {
  rank: { name: string; points: number }; streak: { current: number; longest: number }; plan: string;
  courses: { slug: string; bonus: boolean; complete: boolean; modules: { position: number; state: string; reason: string | null; gated: boolean }[] }[];
};
const states = async (who: Who = "learner") => (await progress(who)).courses.find((c) => c.slug === SLUG)!.modules.map((m) => m.state);
/** Every item in a module, done the way a learner does it. */
async function finish(m: number, who: Who = "learner") {
  await watched(mods[m].video, who);
  await attempt(mods[m].quiz, { answer: { choice: 0 } }, who);
  for (const id of [mods[m].assignment, mods[m].sandbox]) { await attempt(id, {}, who); await complete(id, who); }
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Test search study', 'web', 'https://example.org/search', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id;
  const academy = (await q("insert into public.academies (slug, name) values ($1, 'Search services (test)') returning id", [SLUG])).rows[0].id;
  await q("insert into public.catalog_topics (slug, name, audience_level, origin) values ($1, 'Search services (test)', 'beginner', 'owner')", [SLUG]);
  await q("update public.topics set catalog_slug = $1, published = true, teen_hidden = false, has_course = true where slug = $1", [SLUG]);
  const recipe = { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 0, boosters: [] };
  const plan = {
    structure: 2, sizeTier: "standard", title: "Search services (test)", outcome: "Test outcome",
    modules: Array.from({ length: 5 }, (_, i) => ({
      title: `Test module ${i + 1}`, stage: "Foundations", recipe,
      lessons: [{ title: `Test lesson ${i + 1}`, minutes: 10, objectives: ["Test objective"], keyClaims: [{ claim: "Test claim.", sourceId: source }] }],
      skills: [], videos: [{ title: `Test video ${i + 1}`, brief: { purpose: "Test", points: [{ text: "Test point" }], targetMinutes: 5 } }],
    })),
  };
  const bp = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by, source_ids)
    values ($1, $2, 'course', 'Search', 'beginner', $3, 'ai', $4) returning id`, [ROLE_ID.owner, academy, JSON.stringify(plan), [source]])).rows[0].id;
  courseId = (await q("select public.approve_course_blueprint($1, $2) as id", [bp, ROLE_ID.owner])).rows[0].id;
  // The Owner's module reviews are tested in the C1 suite; here the course is published directly as test setup.
  await q("update public.courses set owner_review_required = false, license_notice = 'Test: some places need a business license. General information only.' where id = $1", [courseId]);
  const cite = JSON.stringify({ sourceId: source, title: "Test search study", url: "https://example.org/search", quote: "Test quote" });
  const modules = (await q("select id, position from public.modules where course_id = $1 order by position", [courseId])).rows;
  // Labels are set while the course is a Draft (publishing the first lesson publishes the version).
  await q("update public.video_slots s set importance = 'important' from public.modules m where m.id = s.module_id and m.course_id = $1", [courseId]);
  for (const m of modules) {
    const l = (await q("select id from public.lessons where module_id = $1", [m.id])).rows[0].id;
    const slot = (await q("select id from public.video_slots where module_id = $1", [m.id])).rows[0].id;
    const up = (await q(`insert into public.video_uploads (slot_id, storage_path, mime, size_bytes, uploaded_by_account_id)
      values ($1::uuid, $1::text || '/' || gen_random_uuid() || '.mp4', 'video/mp4', 1000, $2) returning id`, [slot, ROLE_ID.owner])).rows[0].id;
    await q("select public.accept_video_upload($1)", [up]);
    await q("update public.video_slots set status = 'approved', transcript = 'Test transcript long enough.', approved_at = now(), approved_by_account_id = $2 where id = $1", [slot, ROLE_ID.owner]);
    const v = (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, created_by_account_id)
      values ($1, $2, 1, 'Test lesson', $3, $4, $5) returning id`, [l, courseId, JSON.stringify({ summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text: "Test text.", refs: [1] }] }], takeaways: [] }),
      JSON.stringify([{ ref: 1, sourceId: source, title: "Test search study", url: "https://example.org/search", license: "web_summarize_only", lastChecked: "2026-09-01" }]), ROLE_ID.owner])).rows[0].id;
    await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
    await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2, verification_note = 'Checked' where id = $1", [v, ROLE_ID.reviewer]);
    const add = async (type: string, grading: string, part: string, content: unknown, key: unknown, importance: string, note: string | null, mission: string | null = null) =>
      (await q(`insert into public.activity_items (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key, explanation, citation, recipe_part, importance, notebook_note, mission_type)
        values ($1, $2, $3, $4, $5, $6, 'beginner', 'Test goal', $7, $8, $9, 'Test explanation.', $10, $11, $12, $13, $14) returning id`,
      [l, m.id, courseId, `test-${type.replace(/_/g, "-")}`, type, grading, `Test ${part} ${m.position}?`, JSON.stringify(content), key === null ? null : JSON.stringify(key), cite, part, importance, note, mission])).rows[0].id as string;
    const quiz = await add("multiple_choice", "code", "quiz", { options: ["A", "B"] }, { correct: 0 }, "very_important", "Test note: the title tag is the first thing a search result shows.");
    const assignment = await add("short_answer", "feedback", "assignment", { sampleAnswer: "Test answer" }, null, "should_know", null, m.position === 1 ? "contact_business" : null);
    const sandbox = await add("spot_the_mistake", "feedback", "sandbox", { passage: "Test passage", mistake: "Test mistake" }, null, "important", null);
    await q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now(), review_note = 'Checked' where id = any($1)", [[quiz, assignment, sandbox], ROLE_ID.reviewer]);
    await q("select public.publish_module_activities($1, $2)", [m.id, ROLE_ID.owner]);
    await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where id = $1", [v, ROLE_ID.owner]);
    mods.push({ id: m.id, lesson: l, video: slot, quiz, assignment, sandbox });
  }
  await q("update public.courses set status = 'published', published_at = now() where id = $1", [courseId]);
  await q(`insert into public.course_capstones (course_id, title, deliverables, checklist, automation)
    values ($1, 'Test capstone', '["A one-page test plan"]', '["I checked my plan"]', '{"what":"Drafting test replies","prompts":["Test prompt"],"plans":[]}')`, [courseId]);
  // The learner: on the trial since yesterday, with the course's business picked.
  await q("insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'trial', now() - interval '1 day')", [ROLE_ID.learner]);
  await q("insert into public.learner_picks (user_id, topic_id, kind) select $1, id, 'business' from public.topics where slug = $2", [ROLE_ID.learner, SLUG]);
  // A teen (15) on Basic, with a verified Guardian (the seeded Guardian). Set up directly as test data.
  await q("set session_replication_role = replica");
  teenId = (await q(`insert into public.accounts (clerk_user_id, email, email_verified, role, is_minor, status, date_of_birth, clerk_updated_at)
    values ('user_int_c2teen', 'c2teen@example.com', true, 'learner', true, 'active', (current_date - interval '15 years')::date, now()) returning id`)).rows[0].id;
  await q("insert into public.guardian_relationships (guardian_account_id, teen_account_id, verification_status, authorized_at) values ($1, $2, 'verified', now())", [ROLE_ID.guardian, teenId]);
  await q("set session_replication_role = default");
  await q("insert into public.profiles (account_id, display_name) values ($1, 'Test Teen')", [teenId]);
  const d = trustedDeviceRow(teenId);
  await q("insert into public.trusted_devices (account_id, name, kind, trust_state, device_key_hash, trusted_at, last_seen_at) values ($1, $2, 'laptop', 'trusted', $3, now(), now())", [teenId, d.name, d.device_key_hash]);
  await q("insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', 'basic', now() - interval '1 day')", [teenId]);
}, 90_000);
afterAll(() => stack?.stop());

describe("C2 unlock rules on the real database", () => {
  it("on the trial, module 1 is open and module 2 is locked with a reason; a locked lesson or item says why", async () => {
    expect(await states()).toEqual(["open", "locked", "locked", "locked", "locked"]);
    const l2 = await lesson(1);
    expect(l2.status).toBe(403);
    expect(l2.reason).toMatch(/half of module 1/i);
    expect((await attempt(mods[1].quiz, { answer: { choice: 0 } })).status).toBe(403);
    expect((await watched(mods[1].video)).status).toBe(403);
  });

  it("the lesson shows each item's label, open and done; the course notice shows once", async () => {
    const r = await lesson(0);
    expect(r.status).toBe(200);
    const p2 = r.body.progress2 as { items: { id: string; importanceLabel: string; open: boolean; done: boolean }[]; notices: { kind: string }[]; module: { state: string } };
    expect(p2.module.state).toBe("open");
    expect(p2.items.map((i) => i.importanceLabel)).toEqual(["Important", "Very important", "Should know", "Important"]);
    expect(p2.items.every((i) => i.open && !i.done)).toBe(true);
    expect(p2.notices).toEqual([{ kind: "license", text: expect.stringMatching(/business license/) }]);
    expect(((await lesson(0)).body.progress2 as { notices: unknown[] }).notices).toEqual([]);
  });

  it("a quiz counts at 80% or more; practice is marked done only after trying it; a quiz isn't marked done by hand", async () => {
    expect((await complete(mods[0].assignment)).reason).toMatch(/Try it first/);
    expect((await complete(mods[0].quiz)).reason).toMatch(/80%/);
    const wrong = await attempt(mods[0].quiz, { answer: { choice: 1 } });
    expect(wrong.body).toMatchObject({ quizScore: 0, done: false });
    const right = await attempt(mods[0].quiz, { answer: { choice: 0 } });
    expect(right.body).toMatchObject({ quizScore: 1, done: true });
    const n = (await q("select count(*)::int as n, max(points) as p from public.item_completions where account_id = $1", [ROLE_ID.learner])).rows[0];
    expect(n).toEqual({ n: 1, p: 3 });
  });

  it("a Very important item puts its note in the Notebook, filed under quizzes", async () => {
    const nb = (await call(notebookRoute, "GET", "/api/v1/learn/notebook", "learner")).body as { categories: { key: string; entries: { note: string; importanceLabel: string }[] }[] };
    expect(nb.categories.find((c) => c.key === "quizzes")!.entries).toEqual([expect.objectContaining({ note: expect.stringMatching(/title tag/), importanceLabel: "Very important" })]);
    expect(nb.categories.filter((c) => c.key !== "quizzes").every((c) => !c.entries.length)).toBe(true);
  });

  it("half of module 1 half-opens module 2 (its first half only); all of module 1 opens it fully", async () => {
    expect((await watched(mods[0].video)).body).toMatchObject({ done: true, new: true, points: 2 });
    expect(await states()).toEqual(["open", "half", "locked", "locked", "locked"]);
    expect((await lesson(1)).status).toBe(200);
    // Module 2's first half (its video and quiz) is open; its second half isn't.
    expect((await attempt(mods[1].quiz, { answer: { choice: 0 } })).status).toBe(200);
    expect((await attempt(mods[1].sandbox)).status).toBe(403);
    for (const id of [mods[0].assignment, mods[0].sandbox]) { await attempt(id); expect((await complete(id)).status).toBe(200); }
    // Done twice is still once.
    expect((await complete(mods[0].sandbox)).body).toMatchObject({ new: false });
    expect(await states()).toEqual(["open", "open", "locked", "locked", "locked"]);
  });

  it("modules 1 and 2 done on the trial before day 14 earn half of module 3, kept after converting to Basic", async () => {
    await finish(1);
    const p = await progress();
    const c = p.courses.find((x) => x.slug === SLUG)!;
    expect(c.bonus).toBe(true);
    expect(c.modules.map((m) => m.state)).toEqual(["open", "open", "half", "locked", "locked"]);
    expect((await q("select count(*)::int as n from public.trial_bonuses where account_id = $1", [ROLE_ID.learner])).rows[0].n).toBe(1);
    // On Basic the bonus is kept (it never shrinks what was open), and the usual rules now open all of module 3:
    // module 2 is done and the rank is reached.
    await q("update public.entitlements set tier = 'basic' where account_id = $1", [ROLE_ID.learner]);
    const after = (await progress()).courses.find((x) => x.slug === SLUG)!;
    expect(after.bonus).toBe(true);
    expect(after.modules.map((m) => m.state)).toEqual(["open", "open", "open", "locked", "locked"]);
    expect((await lesson(2)).status).toBe(200);
  });

  it("My progress: rank and points from finished items, a streak of today, gated modules with reasons", async () => {
    const p = await progress();
    // Module 1 and 2: video 2 + quiz 3 + assignment 1 + sandbox 2 = 8 each.
    expect(p.rank).toMatchObject({ points: 16, name: "Explorer" });
    expect(p.streak).toEqual({ current: 1, longest: 1 });
    const m = p.courses.find((x) => x.slug === SLUG)!.modules;
    expect(m.filter((x) => x.gated).map((x) => x.position)).toEqual([3, 4, 5]);
    expect(m[3].reason).toMatch(/rank|module 3/i);
  });

  it("the course is complete only with every module and the capstone", async () => {
    const url = `/api/v1/learn/capstones/${courseId}`;
    const cap = await call(capstoneRoute, "GET", url, "learner", undefined, { courseId });
    expect(cap.body).toMatchObject({ title: "Test capstone", courseComplete: false, automation: { paidPlanNote: expect.stringMatching(/paid plan may be needed/i) } });
    const r = await call(capstoneRoute, "PUT", url, "learner", { checked: { d0: true, c0: true } }, { courseId });
    expect(r.body).toMatchObject({ completedAt: expect.any(String), courseComplete: false });
  });
});

describe("C2 Notebook", () => {
  it("My ideas is the learner's own journal: add, edit, delete; no one else can touch it", async () => {
    const add = await call(ideasRoute, "POST", "/api/v1/learn/notebook/ideas", "learner", { body: "Test idea: a checklist for local shops." });
    expect(add.status).toBe(201);
    const id = (add.body as { ideas: { id: string }[] }).ideas[0].id;
    expect((await call(ideaRoute, "PATCH", `/api/v1/learn/notebook/ideas/${id}`, "teen", { body: "Not mine" }, { id })).status).toBe(404);
    expect((await call(ideaRoute, "PATCH", `/api/v1/learn/notebook/ideas/${id}`, "learner", { body: "Test idea, edited." }, { id })).body).toMatchObject({ ideas: [{ body: "Test idea, edited." }] });
    expect((await call(ideaRoute, "DELETE", `/api/v1/learn/notebook/ideas/${id}`, "learner", undefined, { id })).body).toMatchObject({ ideas: [] });
  });

  it("AI summaries are off by default; turned on, they use the AI path or say plainly why not", async () => {
    expect((await call(summaryRoute, "POST", "/api/v1/learn/notebook/summary", "learner", {})).reason).toMatch(/off/);
    expect((await call(aiRoute, "PUT", "/api/v1/learn/notebook/ai", "learner", { on: true })).body).toMatchObject({ ai: { on: true, dailyLimit: 3 } });
    if (!aiConfigured()) expect((await call(summaryRoute, "POST", "/api/v1/learn/notebook/summary", "learner", {})).status).toBe(503);
  });
});

describe("C2 leaderboard", () => {
  it("an adult appears only after picking a nickname, can opt out, and the Owner can remove a nickname", async () => {
    const before = (await call(boardRoute, "GET", "/api/v1/leaderboard", "learner")).body as { kind: string; rows: unknown[]; settings: { shown: boolean } };
    expect(before).toMatchObject({ kind: "public", rows: [], settings: { shown: false } });
    expect((await call(nicknameRoute, "PUT", "/api/v1/leaderboard/nickname", "learner", { nickname: "Owner_1" })).status).toBe(400);
    const set = await call(nicknameRoute, "PUT", "/api/v1/leaderboard/nickname", "learner", { nickname: "Comet_Rider" });
    expect(set.body).toMatchObject({ settings: { shown: true }, rows: [{ nickname: "Comet_Rider", rank: "Operator", streak: 1, you: true }] });
    // Only nickname, rank, points and streak: no name, email or id.
    expect(Object.keys((set.body.rows as Record<string, unknown>[])[0]).sort()).toEqual(["nickname", "points", "rank", "rankIndex", "streak", "you"]);
    expect((await call(visibilityRoute, "PUT", "/api/v1/leaderboard/visibility", "learner", { optOut: true })).body).toMatchObject({ rows: [], settings: { optOut: true } });
    await call(visibilityRoute, "PUT", "/api/v1/leaderboard/visibility", "learner", { optOut: false });
    expect((await call(moderationRoute, "POST", "/api/v1/leaderboard/moderation", "superAdmin", { nickname: "Comet_Rider", reason: "Test" })).status).toBe(403);
    expect((await call(moderationRoute, "POST", "/api/v1/leaderboard/moderation", "owner", { nickname: "comet_rider", reason: "Test: not allowed" })).status).toBe(200);
    expect((await call(boardRoute, "GET", "/api/v1/leaderboard", "learner")).body).toMatchObject({ rows: [], settings: { removed: true, nickname: null } });
    expect((await q("select reason from public.audit_events where action = 'leaderboard.moderate' and result = 'completed'")).rows).toEqual([{ reason: "Test: not allowed" }]);
    await call(nicknameRoute, "PUT", "/api/v1/leaderboard/nickname", "learner", { nickname: "Comet_Two" });
  });

  it("a teen sees only practice rivals, each labelled, plus their own row; teens are never on the public board", async () => {
    const t = (await call(boardRoute, "GET", "/api/v1/leaderboard", "teen")).body as { kind: string; rows: { nickname: string; simulated?: boolean; label?: string; you?: boolean }[] };
    expect(t.kind).toBe("practice");
    expect(t.rows.filter((r) => r.you)).toHaveLength(1);
    expect(t.rows.filter((r) => !r.you).every((r) => r.simulated && r.label === RIVAL_LABEL)).toBe(true);
    expect(t.rows.some((r) => r.nickname === "Comet_Two")).toBe(false);
    expect((await call(nicknameRoute, "PUT", "/api/v1/leaderboard/nickname", "teen", { nickname: "Swift_Teen" })).status).toBe(403);
    // Even with a nickname written directly, the database view leaves teens out.
    await q("update public.profiles set nickname = 'Teen_Direct' where account_id = $1", [teenId]);
    const adult = (await call(boardRoute, "GET", "/api/v1/leaderboard", "learner")).body as { rows: { nickname: string }[] };
    expect(adult.rows.map((r) => r.nickname)).toEqual(["Comet_Two"]);
  });
});

describe("C2 teen missions", () => {
  const m1 = () => mods[0].assignment;
  it("an adult does a mission with no Guardian step (done above)", async () => {
    expect((await q("select count(*)::int as n from public.item_completions where account_id = $1 and item_id = $2", [ROLE_ID.learner, m1()])).rows[0].n).toBe(1);
  });

  it("a teen needs a state, then the state on the Owner's allow-list, then the Guardian's course approval, then a contact approval each time", async () => {
    await attempt(m1(), {}, "teen");
    expect((await complete(m1(), "teen")).reason).toMatch(/Add your state/);
    expect((await call(stateRoute, "PUT", "/api/v1/account/state", "teen", { state: "ZZ" })).status).toBe(400);
    expect((await call(stateRoute, "PUT", "/api/v1/account/state", "teen", { state: "OR" })).status).toBe(200);
    // The state itself isn't in the audit log.
    expect((await q("select count(*)::int as n from public.audit_events where action = 'account.state' and (new_value like '%OR%' or context like '%Oregon%')")).rows[0].n).toBe(0);
    expect((await complete(m1(), "teen")).reason).toMatch(/isn't open to teens in your state/);
    expect((await call(allowRoute, "PUT", "/api/v1/missions/allowlist", "superAdmin", { missionType: "contact_business", state: "OR", teensAllowed: true, reason: "Test" })).status).toBe(403);
    expect((await call(allowRoute, "PUT", "/api/v1/missions/allowlist", "owner", { missionType: "contact_business", state: "OR", teensAllowed: true, reason: "Test: checked with counsel" })).status).toBe(200);
    expect((await complete(m1(), "teen")).reason).toMatch(/Guardian needs to approve real-world missions for this course/);
    expect((await call(requestRoute, "POST", "/api/v1/learn/missions/request", "learner", { itemId: m1(), scope: "course" })).status).toBe(409);
    expect((await call(requestRoute, "POST", "/api/v1/learn/missions/request", "teen", { itemId: m1(), scope: "course" })).status).toBe(201);
    const g = (await call(guardianRoute, "GET", "/api/v1/guardian/missions", "guardian")).body as { requests: { id: string; scope: string; teen: string }[] };
    expect(g.requests).toEqual([expect.objectContaining({ scope: "course", teen: "Test" })]);
    expect((await call(decideRoute, "POST", `/api/v1/guardian/missions/${g.requests[0].id}`, "learner", { decision: "approve" }, { id: g.requests[0].id })).status).toBe(403);
    expect((await call(decideRoute, "POST", `/api/v1/guardian/missions/${g.requests[0].id}`, "guardian", { decision: "approve" }, { id: g.requests[0].id })).status).toBe(200);
    expect((await complete(m1(), "teen")).reason).toMatch(/contacts someone/);
    await call(requestRoute, "POST", "/api/v1/learn/missions/request", "teen", { itemId: m1(), scope: "contact" });
    const c = (await call(guardianRoute, "GET", "/api/v1/guardian/missions", "guardian")).body as { requests: { id: string }[] };
    await call(decideRoute, "POST", `/api/v1/guardian/missions/${c.requests[0].id}`, "guardian", { decision: "approve" }, { id: c.requests[0].id });
    expect((await complete(m1(), "teen")).status).toBe(200);
    // The contact approval was used once.
    expect((await q("select scope, status from public.mission_approvals where teen_account_id = $1 order by requested_at", [teenId])).rows)
      .toEqual([{ scope: "course", status: "approved" }, { scope: "contact", status: "used" }]);
  });
});

describe("C2 picks and topic facts", () => {
  it("a side hustle is picked without a business and locks on Basic", async () => {
    const r = await call(picksRoute, "POST", "/api/v1/learn/picks", "teen", { slug: "newsletter" });
    expect([r.status, r.reason]).toEqual([201, undefined]);
    const again = await call(picksRoute, "POST", "/api/v1/learn/picks", "teen", { slug: "faceless-content" });
    expect([again.status, again.reason]).toEqual([403, "Your side hustle is locked. Only the Owner can change this."]);
  });

  it("the Owner enters cost and outlook with sources and a date; an income claim is refused", async () => {
    const id = (await q("select id from public.topics where slug = 'newsletter'")).rows[0].id;
    const bad = await call(topicRoute, "PATCH", `/api/v1/topics/${id}`, "owner", { riskNotes: "You will earn $2,000 a month", reason: "Test" }, { id });
    expect(bad.status).toBe(400);
    const good = await call(topicRoute, "PATCH", `/api/v1/topics/${id}`, "owner", {
      costLow: 0, costHigh: 50, costSources: [{ title: "Test pricing page", url: "https://example.org/pricing" }], costCheckedOn: "2026-10-01", reason: "Test",
    }, { id });
    expect(good.status).toBe(200);
    expect((await q("select cost_low::int, cost_high::int, cost_checked_on::text from public.topics where id = $1", [id])).rows[0]).toEqual({ cost_low: 0, cost_high: 50, cost_checked_on: "2026-10-01" });
  });

  it("community links are shown to teens unless the Owner hides them", async () => {
    expect((await call(communityRoute, "PUT", "/api/v1/community", "owner", { discordUrl: "https://example.org/discord", socialLinks: [], hideFromTeens: false, reason: "Test" })).status).toBe(200);
    expect((await call(communityRoute, "GET", "/api/v1/community", "teen")).body).toMatchObject({ links: [{ label: "Discord" }], hidden: false });
    await call(communityRoute, "PUT", "/api/v1/community", "owner", { discordUrl: "https://example.org/discord", socialLinks: [], hideFromTeens: true, reason: "Test" });
    expect((await call(communityRoute, "GET", "/api/v1/community", "teen")).body).toMatchObject({ links: [], hidden: true });
    expect((await call(communityRoute, "GET", "/api/v1/community", "learner")).body).toMatchObject({ links: [{ label: "Discord" }] });
  });
});
