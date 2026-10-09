/**
 * C1 against real Postgres behind PostgREST, through the real routes (only Supabase Storage is stood in for, since the
 * files never pass through the app): a v2 course is approved from its Blueprint (5 modules, recipes, video briefs); the
 * income-claims check blocks a lesson from review and says where; the Owner approves each module (no one else can) and
 * publishes; learners see "Video coming" for an empty slot and a short-lived link only for an approved one; a video is
 * checked by its content and size, needs a transcript, and replacing it keeps the old record; unpublishing hides the
 * course from new learners while those who started keep it; a teen never opens a teen-hidden course; an edit to the live
 * course is refused until a new Draft version is started. Test-only data: made-up titles and an example.org source.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";
import type { Account } from "@/lib/auth";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));
// Supabase Storage: the bytes the server reads back, and the links it signs.
const store = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), sizes: new Map<string, number>(), removed: [] as string[] }));
vi.mock("@/lib/courses/video-store", () => ({
  VIDEO_BUCKET: "course-videos",
  signUpload: async (path: string) => ({ url: `https://storage.test/upload/${path}?token=one-time` }),
  headOf: async (path: string) => (store.files.has(path) ? { head: store.files.get(path)!.slice(0, 64), size: store.sizes.get(path) ?? store.files.get(path)!.length } : null),
  removeFile: async (path: string) => { store.removed.push(path); store.files.delete(path); },
  signDownload: async (path: string, seconds: number) => `https://storage.test/signed/${path}?expires=${seconds}`,
}));

import * as approveBpRoute from "@/app/api/v1/courses/[slug]/blueprints/[id]/approve/route";
import * as studioRoute from "@/app/api/v1/courses/[slug]/studio/route";
import * as submitRoute from "@/app/api/v1/courses/[slug]/versions/[id]/submit/route";
import * as textRoute from "@/app/api/v1/courses/[slug]/lessons/[id]/text/route";
import * as reviewRoute from "@/app/api/v1/courses/[slug]/modules/[id]/review/route";
import * as moduleRoute from "@/app/api/v1/courses/[slug]/modules/[id]/route";
import * as publicationRoute from "@/app/api/v1/courses/[slug]/publication/route";
import * as newVersionRoute from "@/app/api/v1/courses/[slug]/new-version/route";
import * as slotRoute from "@/app/api/v1/courses/[slug]/videos/[id]/route";
import * as uploadRoute from "@/app/api/v1/courses/[slug]/videos/[id]/upload/route";
import * as confirmRoute from "@/app/api/v1/courses/[slug]/videos/[id]/upload/[uploadId]/route";
import * as approveSlotRoute from "@/app/api/v1/courses/[slug]/videos/[id]/approve/route";
import * as checklistRoute from "@/app/api/v1/review/checklist/route";
import * as lessonRoute from "@/app/api/v1/learn/lessons/[id]/route";
import * as progressRoute from "@/app/api/v1/learn/lessons/[id]/progress/route";
import * as videoRoute from "@/app/api/v1/learn/videos/[id]/route";
import * as coursesRoute from "@/app/api/v1/learn/courses/route";
import * as topicsRoute from "@/app/api/v1/topics/route";
import * as pickRoute from "@/app/api/v1/learn/picks/route";
import { learnerCourses } from "@/lib/courses/learn";
import { learnerVideoLink } from "@/lib/courses/videos";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
const SLUG = "cold-outreach";
let source = "";
let courseId = "";
let modules: { id: string; position: number }[] = [];
let lessons: { id: string; module_id: string }[] = [];
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  const json = (await res.json()) as Record<string, unknown> & { reason?: string };
  return { status: res.status, body: json, reason: json.reason };
}
const studio = async () => (await call(studioRoute, "GET", `/api/v1/courses/${SLUG}/studio`, "owner", undefined, { slug: SLUG })).body as {
  version: { status: string; ownerReviewRequired: boolean }; canPublish: boolean; publishBlockers: string[]; emptySlots: number; findings: { where: string; text: string }[];
  modules: { id: string; state: { ready: boolean; blockers: string[]; review: { decision: string; current: boolean } | null }; slots: { id: string; status: string }[] }[];
};
const actorOf = (role: RoleKey, isMinor = false) => ({ id: ROLE_ID[role], roleKey: role, isMinor }) as Account;

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
  source = (await q(`insert into public.sources (title, source_type, url, status, approved_by_account_id, approved_at)
    values ('Test outreach study', 'web', 'https://example.org/outreach', 'approved', $1, now()) returning id`, [ROLE_ID.reviewer])).rows[0].id;
  const academy = (await q("insert into public.academies (slug, name) values ($1, 'Cold outreach (test)') returning id", [SLUG])).rows[0].id;
  // The L8 topic, linked to the L6 catalog topic: the one link.
  await q("insert into public.catalog_topics (slug, name, audience_level, origin) values ($1, 'Cold outreach (test)', 'beginner', 'owner')", [SLUG]);
  await q("update public.topics set catalog_slug = $1, published = true, teen_hidden = false, has_course = false where slug = 'cold-outreach'", [SLUG]);
  const recipe = { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] };
  const plan = {
    structure: 2, title: "Cold outreach (test)", outcome: "Test outcome",
    modules: Array.from({ length: 5 }, (_, i) => ({
      title: `Test module ${i + 1}`, stage: "Foundations", recipe,
      lessons: [{ title: `Test lesson ${i + 1}`, minutes: 10, objectives: ["Test objective"], keyClaims: [{ claim: "Test claim.", sourceId: source }] }],
      skills: [{ key: `skill-${i + 1}`, name: `Skill ${i + 1}` }],
      videos: [{ title: `Test video ${i + 1}`, brief: { purpose: "Test purpose", points: [{ text: "Test point", sources: [{ sourceId: source, title: "Test outreach study" }] }], targetMinutes: 5 } }],
    })),
  };
  const bp = (await q(`insert into public.academy_blueprints (account_id, academy_id, kind, topic, audience_level, plan, generated_by, source_ids)
    values ($1, $2, 'course', 'Cold outreach', 'beginner', $3, 'ai', $4) returning id`, [ROLE_ID.owner, academy, JSON.stringify(plan), [source]])).rows[0].id;
  const r = await call(approveBpRoute, "POST", `/api/v1/courses/${SLUG}/blueprints/${bp}/approve`, "owner", {}, { slug: SLUG, id: bp });
  expect(r.status).toBe(200);
  courseId = String(r.body.courseId);
  modules = (await q("select id, position from public.modules where course_id = $1 order by position", [courseId])).rows;
  lessons = (await q("select l.id, l.module_id from public.lessons l join public.modules m on m.id = l.module_id where m.course_id = $1 order by m.position", [courseId])).rows;
}, 60_000);
afterAll(() => stack?.stop());

/** A lesson Draft written by a person (citing the test source), as the drafting step would leave it. */
async function draft(lessonId: string, text: string) {
  return (await q(`insert into public.lesson_versions (lesson_id, course_id, version, title, body, citations, created_by_account_id)
    values ($1, $2, 1, 'Test lesson', $3, $4, $5) returning id`, [lessonId, courseId, JSON.stringify({ summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text, refs: [1] }] }], takeaways: [] }),
    JSON.stringify([{ ref: 1, sourceId: source, title: "Test outreach study", url: "https://example.org/outreach", license: "web_summarize_only", lastChecked: "2026-09-01" }]), ROLE_ID.owner])).rows[0].id as string;
}
/** Four reviewed practice items, one per core part, citing the test source. */
async function items(moduleId: string, lessonId: string) {
  const base = [lessonId, moduleId, courseId];
  const cite = JSON.stringify({ sourceId: source, title: "Test outreach study", url: "https://example.org/outreach", quote: "Test quote" });
  const add = async (type: string, grading: string, part: string, content: unknown, key: unknown) => (await q(`insert into public.activity_items
    (lesson_id, module_id, course_id, idea_key, item_type, grading, level, goal, prompt, content, answer_key, explanation, citation, recipe_part)
    values ($1, $2, $3, $4, $5, $6, 'beginner', 'Test goal', 'Test prompt?', $7, $8, 'Test explanation.', $9, $10) returning id`,
  [...base, `test-${type.replace(/_/g, "-")}`, type, grading, JSON.stringify(content), key === null ? null : JSON.stringify(key), cite, part])).rows[0].id as string;
  const ids = [
    await add("multiple_choice", "code", "quiz", { options: ["A", "B"] }, { correct: 0 }),
    await add("short_answer", "feedback", "assignment", { sampleAnswer: "Test answer" }, null),
    await add("spot_the_mistake", "feedback", "sandbox", { passage: "Test passage", mistake: "Test mistake" }, null),
    await add("ordering", "code", "sequence", { steps: ["One", "Two", "Three"] }, { order: [0, 1, 2] }),
  ];
  await q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now(), review_note = 'Checked' where id = any($1)", [ids, ROLE_ID.reviewer]);
  return ids;
}
const verify = (v: string) => q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2, verification_note = 'Citations checked' where id = $1", [v, ROLE_ID.reviewer]);
const submit = (v: string) => call(submitRoute, "POST", `/api/v1/courses/${SLUG}/versions/${v}/submit`, "owner", {}, { slug: SLUG, id: v });
const decide = (role: RoleKey, moduleId: string, body: Record<string, unknown>) => call(reviewRoute, "POST", `/api/v1/courses/${SLUG}/modules/${moduleId}/review`, role, body, { slug: SLUG, id: moduleId });

describe("C1 on the real database", () => {
  it("a v2 Blueprint becomes 5 modules with recipes and a video slot each, needing the Owner's review", async () => {
    const s = await studio();
    expect(s.version).toMatchObject({ status: "draft", ownerReviewRequired: true });
    expect(s.modules).toHaveLength(5);
    expect(s.emptySlots).toBe(5);
    expect(s.canPublish).toBe(false);
  });

  it("the income-claims check blocks a lesson from review and says exactly what and where; reworded, it goes through", async () => {
    const v = await draft(lessons[0].id, "Send ten emails a day and you will earn $5,000 a month in passive income.");
    const r = await submit(v);
    expect(r.status).toBe(409);
    expect(r.reason).toMatch(/can't go to review/);
    expect(r.reason).toMatch(/section 1 "Test" › paragraph 1: "earn \$5,000"/);
    expect((await q("select status from public.lesson_versions where id = $1", [v])).rows[0].status).toBe("draft");
    // The Owner rewords it in the editor (audited), then it goes to review.
    const e = await call(textRoute, "PATCH", `/api/v1/courses/${SLUG}/lessons/${lessons[0].id}/text`, "owner", { paragraphs: { "0.0": "Send a short, specific first line that shows you read their page." } }, { slug: SLUG, id: lessons[0].id });
    expect(e.status).toBe(200);
    expect((await submit(v)).status).toBe(200);
    const audit = (await q("select action, result from public.audit_events where action in ('courses.lesson.edit', 'courses.lesson.submit') order by occurred_at")).rows;
    expect(audit).toEqual([{ action: "courses.lesson.submit", result: "blocked" }, { action: "courses.lesson.edit", result: "completed" }, { action: "courses.lesson.submit", result: "completed" }]);
  });

  it("only the Owner approves; a module approves only when ready; the course publishes only when every module is approved", async () => {
    // Module 1: verified and with its practice; everything else gets the same.
    await verify((await q("select id from public.lesson_versions where lesson_id = $1", [lessons[0].id])).rows[0].id);
    const m1 = modules[0].id;
    expect((await decide("owner", m1, { decision: "approve" })).reason).toMatch(/Not ready.*No reviewed quiz/);
    await items(m1, lessons[0].id);
    expect((await decide("reviewer", m1, { decision: "approve" })).status).toBe(403);
    expect((await decide("superAdmin", m1, { decision: "approve" })).status).toBe(403);
    expect((await decide("owner", m1, { decision: "send_back", note: "" })).status).toBe(400);
    expect((await decide("owner", m1, { decision: "approve" })).status).toBe(201);
    const s = await studio();
    expect(s.modules[0].state.review).toMatchObject({ decision: "approved", current: true });
    expect(s.publishBlockers.join(" ")).toMatch(/Module 2 "Test module 2" needs the Owner's approval/);
    expect((await call(publicationRoute, "POST", `/api/v1/courses/${SLUG}/publication`, "owner", { reason: "Test publish" }, { slug: SLUG })).reason).toMatch(/Not ready to publish/);
    // The Owner's checklist shows what waits.
    const list = (await call(checklistRoute, "GET", "/api/v1/review/checklist", "owner")).body as { courses: { slug: string; approved: number; emptySlots: unknown[]; income: { ok: boolean } }[] };
    expect(list.courses.find((c) => c.slug === SLUG)).toMatchObject({ approved: 1, income: { ok: true } });
    expect((await call(checklistRoute, "GET", "/api/v1/review/checklist", "superAdmin")).status).toBe(403);
  });

  it("a send-back returns the module to Draft with the note; approving again after review publishes with empty video slots counted", async () => {
    for (const [i, m] of modules.entries()) {
      if (i === 0) continue;
      const v = await draft(lessons[i].id, "Write a first line about the prospect's own work.");
      await submit(v);
      await verify(v);
      await items(m.id, lessons[i].id);
    }
    const m2 = modules[1].id;
    expect((await decide("owner", m2, { decision: "send_back", note: "Test: add a real-world example" })).status).toBe(201);
    const back = (await q("select status, returned_note from public.lesson_versions where lesson_id = $1", [lessons[1].id])).rows[0];
    expect(back).toEqual({ status: "draft", returned_note: "Sent back by the Owner: Test: add a real-world example" });
    const v2 = back && (await q("select id from public.lesson_versions where lesson_id = $1", [lessons[1].id])).rows[0].id;
    await submit(v2);
    await verify(v2);
    for (const m of modules.slice(1)) expect((await decide("owner", m.id, { decision: "approve" })).status).toBe(201);
    const p = await call(publicationRoute, "POST", `/api/v1/courses/${SLUG}/publication`, "owner", { reason: "Test publish" }, { slug: SLUG });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ published: true, lessons: 5, items: 20, emptySlots: 5 });
    expect((await q("select has_course from public.topics where catalog_slug = $1", [SLUG])).rows[0].has_course).toBe(true);
    expect((await q("select result from public.audit_events where action = 'courses.publish_course' order by occurred_at desc limit 1")).rows[0].result).toBe("completed");
  });

  it("learners see the published course, \"Video coming\" for an empty slot, and \"Practice (simulated)\" on a sandbox", async () => {
    const r = await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessons[0].id}`, "learner", undefined, { id: lessons[0].id });
    expect(r.status).toBe(200);
    const body = r.body as { videos: { state: string; title: string }[]; activities: { label: string; simulated: boolean }[]; lesson: { review: unknown } };
    expect(body.videos).toEqual([{ id: expect.any(String), title: "Test video 1", state: "coming", transcript: null }]);
    expect(body.activities.find((a) => a.simulated)?.label).toBe("Practice (simulated)");
    expect(body.lesson.review).toMatchObject({ by: "owner", date: expect.any(String) });
    const slot = body.videos[0] as unknown as { id: string };
    expect((await call(videoRoute, "GET", `/api/v1/learn/videos/${slot.id}`, "learner", undefined, { id: slot.id })).status).toBe(404);
    // The chooser opens the course for a linked topic.
    const topics = (await call(pickRoute, "GET", "/api/v1/learn/picks", "learner")).body as { skills: { slug: string; courseHref: string | null }[] };
    expect(topics.skills.find((t) => t.slug === "cold-outreach")?.courseHref).toBe(`/learn/${lessons[0].id}`);
    const admin = (await call(topicsRoute, "GET", "/api/v1/topics", "owner")).body as { topics: { slug: string; course: { status: string } }[] };
    expect(admin.topics.find((t) => t.slug === "cold-outreach")?.course.status).toBe("published");
  });

  it("an edit to the live course is refused until a new Draft version is started", async () => {
    const r = await call(moduleRoute, "PATCH", `/api/v1/courses/${SLUG}/modules/${modules[0].id}`, "owner", { title: "Renamed" }, { slug: SLUG, id: modules[0].id });
    expect(r.status).toBe(409);
    expect(r.reason).toMatch(/Start a new version/);
  });

  describe("video slots", () => {
    let slot = "";
    const start = (size: number, name = "intro.mp4", type = "video/mp4") => call(uploadRoute, "POST", `/api/v1/courses/${SLUG}/videos/${slot}/upload`, "owner", { name, size, type }, { slug: SLUG, id: slot });
    const confirm = (uploadId: string) => call(confirmRoute, "POST", `/api/v1/courses/${SLUG}/videos/${slot}/upload/${uploadId}`, "owner", {}, { slug: SLUG, id: slot, uploadId });
    const put = async (uploadId: string, bytes: Uint8Array, size?: number) => {
      const path = (await q("select storage_path from public.video_uploads where id = $1", [uploadId])).rows[0].storage_path;
      store.files.set(path, bytes);
      if (size) store.sizes.set(path, size);
      return path;
    };
    beforeAll(async () => {
      slot = (await q("select id from public.video_slots where module_id = $1", [modules[0].id])).rows[0].id;
    });

    it("refuses a file over the limit with a clear message, and anything but mp4 or webm", async () => {
      const big = await start(80 * 1024 * 1024);
      expect(big.status).toBe(413);
      expect(big.reason).toMatch(/80\.0 MB.*50 MB/);
      expect((await start(1000, "notes.pdf", "application/pdf")).status).toBe(415);
      expect((await call(uploadRoute, "POST", `/api/v1/courses/${SLUG}/videos/${slot}/upload`, "courseAdmin", { name: "a.mp4", size: 1000, type: "video/mp4" }, { slug: SLUG, id: slot })).status).toBe(403);
    });

    it("checks the file by its content: a renamed file is rejected and removed, the record kept", async () => {
      const s = await start(2000);
      expect(s.status).toBe(201);
      expect(String(s.body.url)).toMatch(/^https:\/\/storage\.test\/upload\//);
      const path = await put(String(s.body.uploadId), new TextEncoder().encode("%PDF-1.7 not a video at all, just a renamed file"));
      const c = await confirm(String(s.body.uploadId));
      expect(c.status).toBe(415);
      expect(store.removed).toContain(path);
      expect((await q("select status, reject_reason from public.video_uploads where id = $1", [s.body.uploadId])).rows[0]).toMatchObject({ status: "rejected", reject_reason: expect.stringMatching(/isn't an mp4 or webm/) });
      // A file that turns out larger than the limit once uploaded is rejected too.
      const s2 = await start(2000);
      await put(String(s2.body.uploadId), MP4, 60 * 1024 * 1024);
      expect((await confirm(String(s2.body.uploadId))).status).toBe(413);
    });

    it("an accepted video needs a transcript and the Owner's approval; then learners get a ten-minute link", async () => {
      const s = await start(5000);
      await put(String(s.body.uploadId), MP4);
      const c = await confirm(String(s.body.uploadId));
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ status: "uploaded" });
      const approve = () => call(approveSlotRoute, "POST", `/api/v1/courses/${SLUG}/videos/${slot}/approve`, "owner", {}, { slug: SLUG, id: slot });
      expect((await approve()).reason).toMatch(/transcript/);
      await call(slotRoute, "PATCH", `/api/v1/courses/${SLUG}/videos/${slot}`, "owner", { transcript: "Test transcript: what a good first line looks like." }, { slug: SLUG, id: slot });
      expect((await approve()).status).toBe(200);
      const link = await call(videoRoute, "GET", `/api/v1/learn/videos/${slot}`, "learner", undefined, { id: slot });
      expect(link.status).toBe(200);
      expect(link.body).toMatchObject({ url: expect.stringMatching(/expires=600$/), expiresIn: 600, transcript: expect.stringMatching(/^Test transcript/) });
      const lesson = (await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessons[0].id}`, "learner", undefined, { id: lessons[0].id })).body as { videos: { state: string }[] };
      expect(lesson.videos[0].state).toBe("ready");
      expect((await studio()).emptySlots).toBe(4);
    });

    it("replacing the video adds a record, keeps the old one, and needs approving again", async () => {
      const s = await start(6000);
      await put(String(s.body.uploadId), MP4);
      expect((await confirm(String(s.body.uploadId))).status).toBe(200);
      const trail = (await q("select status from public.video_uploads where slot_id = $1 order by uploaded_at", [slot])).rows.map((r) => r.status);
      expect(trail).toEqual(["rejected", "rejected", "replaced", "accepted"]);
      expect((await q("select status from public.video_slots where id = $1", [slot])).rows[0].status).toBe("uploaded");
      expect((await call(videoRoute, "GET", `/api/v1/learn/videos/${slot}`, "learner", undefined, { id: slot })).status).toBe(404);
    });
  });

  it("a teen never opens a course hidden from teens, nor its videos", async () => {
    await q("update public.video_slots set status = 'approved', approved_at = now(), approved_by_account_id = $2 where id = (select id from public.video_slots where module_id = $1)", [modules[0].id, ROLE_ID.owner]);
    const slot = (await q("select id from public.video_slots where module_id = $1", [modules[0].id])).rows[0].id;
    expect((await learnerCourses(actorOf("learner", true))).some((c: { slug: string }) => c.slug === SLUG)).toBe(true);
    await q("update public.topics set teen_hidden = true where catalog_slug = $1", [SLUG]);
    expect((await learnerCourses(actorOf("learner", true))).some((c: { slug: string }) => c.slug === SLUG)).toBe(false);
    expect((await learnerVideoLink(actorOf("learner", true), slot)).ok).toBe(false);
    expect((await learnerVideoLink(actorOf("learner"), slot)).ok).toBe(true);
    await q("update public.topics set teen_hidden = false where catalog_slug = $1", [SLUG]);
  });

  it("unpublishing hides the course from new learners; a learner who started keeps it and their progress", async () => {
    const v = (await q("select id from public.lesson_versions where lesson_id = $1 and status = 'published'", [lessons[0].id])).rows[0].id;
    expect((await call(progressRoute, "POST", `/api/v1/learn/lessons/${lessons[0].id}/progress`, "learner", { versionId: v, status: "complete" }, { id: lessons[0].id })).status).toBe(200);
    const u = await call(publicationRoute, "DELETE", `/api/v1/courses/${SLUG}/publication`, "owner", { reason: "Test: pausing the course" }, { slug: SLUG });
    expect(u.status).toBe(200);
    const mine = (await call(coursesRoute, "GET", "/api/v1/learn/courses", "learner")).body as { courses: { slug: string }[] };
    expect(mine.courses.some((c) => c.slug === SLUG)).toBe(true);
    const fresh = (await call(coursesRoute, "GET", "/api/v1/learn/courses", "support")).body as { courses: { slug: string }[] };
    expect(fresh.courses.some((c) => c.slug === SLUG)).toBe(false);
    expect((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessons[0].id}`, "support", undefined, { id: lessons[0].id })).status).toBe(404);
    expect((await q("select count(*)::int as n from public.progress_records where account_id = $1", [ROLE_ID.learner])).rows[0].n).toBe(1);
    expect((await q("select has_course from public.topics where catalog_slug = $1", [SLUG])).rows[0].has_course).toBe(false);
    // Published again by the Owner: open to everyone.
    expect((await call(publicationRoute, "POST", `/api/v1/courses/${SLUG}/publication`, "owner", { reason: "Test: back on" }, { slug: SLUG })).status).toBe(200);
    const again = (await call(coursesRoute, "GET", "/api/v1/learn/courses", "support")).body as { courses: { slug: string }[] };
    expect(again.courses.some((c) => c.slug === SLUG)).toBe(true);
  });

  it("a new version is a Draft copy that needs the Owner's approval again; the live one stays", async () => {
    const r = await call(newVersionRoute, "POST", `/api/v1/courses/${SLUG}/new-version`, "owner", {}, { slug: SLUG });
    expect(r.status).toBe(201);
    expect(r.body.version).toBe(2);
    const s = await studio();
    expect(s.version.status).toBe("draft");
    expect(s.modules.every((m) => !m.state.review?.current)).toBe(true);
    const e = await call(moduleRoute, "PATCH", `/api/v1/courses/${SLUG}/modules/${s.modules[0].id}`, "owner", { title: "Test module one, revised" }, { slug: SLUG, id: s.modules[0].id });
    expect(e.status).toBe(200);
    expect((await call(lessonRoute, "GET", `/api/v1/learn/lessons/${lessons[0].id}`, "learner", undefined, { id: lessons[0].id })).status).toBe(200);
  });
});
