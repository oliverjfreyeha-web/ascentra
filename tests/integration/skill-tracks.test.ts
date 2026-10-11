/**
 * S1 against real Postgres behind PostgREST, through the real routes. The Owner imports a fake skill track (format 2,
 * Rounds 1-3); an admin or a learner can't. The track is then published as test setup. A learner on the trial sees
 * Round 1 section 1 open, the rest of Round 1 behind the half-open rule and the trial's half, and Rounds 2 and 3 with
 * truthful plan labels; locked lesson text isn't sent (track or library). Items earn their points × the Round's
 * multiplier, once. Converting to Basic keeps progress and opens the rest of Round 1, then Round 2 when Round 1 is done;
 * Round 3 stays "part of Pro"; Pro opens it. Every answer goes through the pages' readers (app/track-api.ts,
 * app/import-api.ts, app/progress-api.ts). Test-only data.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { sampleCourse, sampleTrack } from "../fixtures/course-import";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as checkRoute from "@/app/api/v1/courses/import/check/route";
import * as createRoute from "@/app/api/v1/courses/import/route";
import * as trackRoute from "@/app/api/v1/learn/tracks/[slug]/route";
import * as libraryRoute from "@/app/api/v1/learn/tracks/[slug]/library/route";
import * as attemptRoute from "@/app/api/v1/learn/activities/[id]/attempt/route";
import * as completeRoute from "@/app/api/v1/learn/activities/[id]/complete/route";
import * as progressRoute from "@/app/api/v1/learn/progress/route";
import * as studioRoute from "@/app/api/v1/courses/[slug]/studio/route";
import { importResultFrom } from "@/app/import-api";
import { libraryFrom, trackFrom, type Track } from "@/app/track-api";
import { progressFrom } from "@/app/progress-api";
import { studioFrom } from "@/app/studio-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
const SLUG = "copywriting";
async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  const json = (await res.json()) as Record<string, unknown> & { reason?: string };
  return { status: res.status, body: json, reason: json.reason };
}
const file = (doc: unknown) => ({ fileName: "test-track.json", content: JSON.stringify(doc) });
const track = async (role: RoleKey = "learner") => trackFrom((await call(trackRoute, "GET", `/api/v1/learn/tracks/${SLUG}`, role, undefined, { slug: SLUG })).body)!;
const library = async (role: RoleKey = "learner") => libraryFrom((await call(libraryRoute, "GET", `/api/v1/learn/tracks/${SLUG}/library`, role, undefined, { slug: SLUG })).body)!;
const shape = (t: Track) => t.rounds.map((r) => `R${r.round}:${r.state} ` + r.sections.map((s) => s.state).join(","));
const plan = (tier: string) => q("insert into public.entitlements (account_id, source, tier, valid_from) values ($1, 'admin_designated', $2, now())", [ROLE_ID.learner, tier]);
/** Does one item the way a learner does: a quiz or ordering answered right, anything else tried and then marked done. */
async function doItem(id: string) {
  const it = (await q("select item_type from public.activity_items where id = $1", [id])).rows[0].item_type as string;
  if (it === "multiple_choice") return attempt(id, { answer: { choice: 0 } });
  if (it === "ordering") return attempt(id, { answer: { order: [0, 1, 2] } });
  await attempt(id, {});
  return call(completeRoute, "POST", `/api/v1/learn/activities/${id}/complete`, "learner", {}, { id });
}
const attempt = (id: string, body: unknown) => call(attemptRoute, "POST", `/api/v1/learn/activities/${id}/attempt`, "learner", body, { id });
const roundItems = async (round: number) => (await q(`select i.id from public.activity_items i join public.modules m on m.id = i.module_id join public.courses c on c.id = m.course_id
  where c.status = 'published' and c.is_track and m.round = $1 order by m.position, i.created_at, i.idea_key`, [round])).rows.map((r) => r.id as string);
/** The Round's items in the learner's order (the track API's), as the page lists them. */
const ordered = async (round: number) => (await track()).rounds[round - 1].sections.flatMap((x) => x.steps.flatMap((st) => st.items.map((i) => i.id)));
const points = async () => (await q("select coalesce(sum(points), 0)::int as p, count(*)::int as n from public.item_completions where account_id = $1", [ROLE_ID.learner])).rows[0] as { p: number; n: number };

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
}, 60_000);
afterAll(() => stack?.stop());

describe("S1 import (format 2) through the routes", () => {
  it("only the Owner checks or imports a track", async () => {
    for (const role of ["superAdmin", "courseAdmin", "reviewer", "learner"] as RoleKey[]) {
      expect((await call(checkRoute, "POST", "/api/v1/courses/import/check", role, file(sampleTrack()))).status).toBe(403);
      expect((await call(createRoute, "POST", "/api/v1/courses/import", role, file(sampleTrack()))).status).toBe(403);
    }
  });

  it("v1/v2 mismatches are refused with a clear message, and nothing is created", async () => {
    const v1 = importResultFrom((await call(checkRoute, "POST", "/api/v1/courses/import/check", "owner", file(sampleCourse(SLUG)))).body)!;
    expect(v1.problems[0].message).toMatch(/is a skill\. A skill is a track of 3 Rounds: use format version 2/);
    const v2 = importResultFrom((await call(createRoute, "POST", "/api/v1/courses/import", "owner", file(sampleTrack("graphic-design")))).body)!;
    expect(v2.problems[0].message).toMatch(/Format version 2 is for skills only/);
    expect((await q("select count(*)::int as n from public.courses")).rows[0].n).toBe(0);
  });

  it("Round 2 before Round 1 is refused; Round 1 then Round 2 make Draft versions, the second carrying Round 1", async () => {
    const early = importResultFrom((await call(createRoute, "POST", "/api/v1/courses/import", "owner", file(sampleTrack(SLUG, [2])))).body)!;
    expect(early.problems[0].message).toMatch(/Round 2 can't be created before Round 1 exists/);
    const one = await call(createRoute, "POST", "/api/v1/courses/import", "owner", file(sampleTrack(SLUG, [1])));
    expect(one.status).toBe(201);
    expect(importResultFrom(one.body)!.created).toMatchObject({ version: 1, rounds: [1], carriedRounds: [] });
    const check = importResultFrom((await call(checkRoute, "POST", "/api/v1/courses/import/check", "owner", file(sampleTrack(SLUG, [2])))).body)!;
    expect(check).toMatchObject({ ok: true, summary: { format: 2, rounds: [2], carriedRounds: [1], newDraftVersion: true } });
    const two = importResultFrom((await call(createRoute, "POST", "/api/v1/courses/import", "owner", file(sampleTrack(SLUG, [2])))).body)!;
    expect(two.created).toMatchObject({ version: 2, rounds: [2], carriedRounds: [1], counts: { sections: 5, carriedSections: 5 } });
  });

  it("all three Rounds in one file; the studio shows a track with its Rounds' status and no size", async () => {
    const all = importResultFrom((await call(createRoute, "POST", "/api/v1/courses/import", "owner", file(sampleTrack(SLUG, [1, 2, 3])))).body)!;
    expect(all.created).toMatchObject({ version: 3, rounds: [1, 2, 3], carriedRounds: [] });
    const s = studioFrom((await call(studioRoute, "GET", `/api/v1/courses/${SLUG}/studio`, "owner", undefined, { slug: SLUG })).body)!;
    expect(s.version).toMatchObject({ version: 3, isTrack: true, rounds: [{ round: 1, sections: 5, status: "Draft" }, { round: 2, sections: 5, status: "Draft" }, { round: 3, sections: 5, status: "Draft" }] });
    expect(s.modules.map((m) => m.round)).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    expect((s.version as { sizeTier?: string | null }).sizeTier).toBeNull();
  });

  it("every check and import is audited with the Round numbers, never the contents", async () => {
    const rows = (await q("select action, result, context from public.audit_events where action like 'courses.import%' and context like '%test-track.json%' order by occurred_at")).rows;
    expect(rows.find((r) => r.action === "courses.import" && r.result === "completed" && /Round 2 \(plus 5 sections of Round 1 carried as Drafts\)/.test(r.context))).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/Test paragraph|one idea per sentence/);
  });
});

describe("S1 learner access, unlock and points", () => {
  beforeAll(async () => {
    // Test setup: version 3 (all three Rounds) published directly; the Owner's per-section approval is the C1 flow.
    const c = (await q("select c.id from public.courses c join public.academies a on a.id = c.academy_id where a.slug = $1 and c.version = 3", [SLUG])).rows[0].id;
    await q("update public.courses set owner_review_required = false where id = $1", [c]);
    await q("update public.sources set status = 'approved', approved_by_account_id = $1, approved_at = now()", [ROLE_ID.reviewer]);
    for (const m of (await q("select id from public.modules where course_id = $1", [c])).rows) {
      await q("update public.activity_items set status = 'approved', reviewed_by_account_id = $2, reviewed_at = now(), review_note = 'Checked' where module_id = $1", [m.id, ROLE_ID.reviewer]);
      await q("select public.publish_module_activities($1, $2)", [m.id, ROLE_ID.owner]);
    }
    await q("update public.lesson_versions set status = 'review', submitted_at = now(), submitted_by_account_id = $2 where course_id = $1", [c, ROLE_ID.owner]);
    await q("update public.lesson_versions set verified_at = now(), verified_by_account_id = $2, verification_note = 'Checked' where course_id = $1", [c, ROLE_ID.reviewer]);
    await q("update public.lesson_versions set status = 'published', published_at = now(), published_by_account_id = $2 where course_id = $1", [c, ROLE_ID.owner]);
    await q("update public.courses set status = 'published', published_at = now() where id = $1", [c]);
    await q("update public.topics set published = true, has_course = true where slug = $1", [SLUG]);
    await q("insert into public.learner_picks (user_id, topic_id, kind) select $1, id, 'skill' from public.topics where slug = $2", [ROLE_ID.learner, SLUG]);
    await plan("trial");
  }, 60_000);

  it("on the trial: Round 1 section 1 open; Rounds 2 and 3 say which plan includes them; no locked lesson text", async () => {
    const t = await track();
    expect(shape(t)).toEqual(["R1:open open,locked,locked,locked,locked", "R2:locked locked,locked,locked,locked,locked", "R3:locked locked,locked,locked,locked,locked"]);
    expect(t.rounds.map((r) => r.reason)).toEqual([null, "Round 2 is part of Basic and Pro.", "Round 3 is part of Pro."]);
    expect(t.rounds[0].sections[0].steps[0].summary).toMatch(/^Test summary 1\.1/);
    expect(t.rounds[0].sections[1].steps[0].summary).toBeNull();
    expect(t.rounds[1].sections.every((s) => s.steps.every((st) => st.summary === null))).toBe(true);
    const lib = await library();
    expect(lib.entries.map((e) => `${e.round}.${e.section}`)).toEqual(["1.1"]);
    expect(lib.lockedRounds.map((r) => r.reason)).toEqual(["Round 2 is part of Basic and Pro.", "Round 3 is part of Pro."]);
    expect(JSON.stringify(lib)).not.toMatch(/Test summary 1\.2|Test summary 2\./);
  });

  it("a locked item is refused by the server too", async () => {
    const r2 = await roundItems(2);
    expect((await attempt(r2[0], { answer: { choice: 0 } })).status).toBe(403);
  });

  it("Round 1 items earn their points × 1, once; the trial stops at half of Round 1 (10 of 20 items)", async () => {
    const r1 = await ordered(1);
    for (const id of r1.slice(0, 4)) await doItem(id);
    expect(await points()).toEqual({ p: 3 + 2 + 1 + 2, n: 4 });
    await doItem(r1[0]);
    expect((await points()).n).toBe(4);
    for (const id of r1.slice(4, 10)) await doItem(id);
    const t = await track();
    expect(t.rounds[0].doneCount).toBe(10);
    expect(shape(t)[0]).toBe("R1:open open,open,half,locked,locked");
    expect(t.rounds[0].sections[3].reason).toBe("Not in the free trial. The rest of Round 1 is part of Basic and Pro.");
    expect((await attempt(r1[10], { answer: { choice: 0 } })).status).toBe(403);
  });

  it("converting to Basic keeps progress, opens the rest of Round 1, then Round 2 when Round 1 is done; Round 3 is part of Pro", async () => {
    await plan("basic");
    expect((await track()).rounds[0].doneCount).toBe(10);
    const r1 = await ordered(1);
    for (const id of r1.slice(10)) await doItem(id);
    const t = await track();
    expect(t.rounds[0]).toMatchObject({ complete: true, doneCount: 20 });
    expect(shape(t).slice(1)).toEqual(["R2:open open,locked,locked,locked,locked", "R3:locked locked,locked,locked,locked,locked"]);
    expect(t.rounds[2].reason).toBe("Round 3 is part of Pro.");
    // "Round complete" in My progress, never "Course complete".
    const p = progressFrom((await call(progressRoute, "GET", "/api/v1/learn/progress", "learner")).body)!;
    const c = p.courses.find((x) => x.slug === SLUG)!;
    expect(c.complete).toBe(false);
    expect(c.track!.rounds.map((r) => r.complete)).toEqual([true, false, false]);
  });

  it("a Round 2 item earns its points × 2, once", async () => {
    const before = await points();
    const quiz = (await ordered(2))[0];
    await doItem(quiz);
    await doItem(quiz);
    expect(await points()).toEqual({ p: before.p + 3 * 2, n: before.n + 1 });
  });

  it("Pro opens Round 3 once Round 2 is done; progress is kept", async () => {
    await plan("pro");
    const t = await track();
    expect(t.rounds[2]).toMatchObject({ state: "locked", reason: "Opens when you finish every item of Round 2." });
    expect(t.rounds[1].doneCount).toBe(1);
  });
});
