/**
 * L8: pick your path. The plan rules one by one (Basic, trial, Pro, Pro to Basic, teens) as pure functions, then the
 * real routes (database faked in memory with the same rules as the SQL functions, Clerk mocked): the five answers, the
 * best matches, the limits with plain counters, the locked business, the Owner's change with a reason, the admin topics
 * page with anonymous demand, and the audit trail. Every page reader is run against the real responses.
 * The SQL functions themselves, parallel picks and row-level security are tested on Postgres in tests/db/topics-picks.test.ts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_l8", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as picksRoute from "@/app/api/v1/learn/picks/route";
import * as pauseRoute from "@/app/api/v1/learn/picks/pause/route";
import * as answersRoute from "@/app/api/v1/learn/picks/answers/route";
import * as topicsRoute from "@/app/api/v1/topics/route";
import * as topicRoute from "@/app/api/v1/topics/[id]/route";
import * as orderRoute from "@/app/api/v1/topics/order/route";
import * as learnerRoute from "@/app/api/v1/topics/learner/route";
import {
  SKILL_LIMIT_BASIC, applyPause, applyPick, checkPathAnswers, pickPlanOf, rankBusinesses, reconcile, scoreBusiness,
  type PathAnswers, type PickRow, type TopicRow,
} from "@/lib/picks/rules";
import { adminTopicsFrom, chooserFrom, learnerPicksFrom } from "@/app/picks-api";

/** The seeded topics, read from the migration itself, so these tests use exactly what ships. */
const SEED = [...readFileSync("db/migrations/0019_topics_and_picks.sql", "utf8").matchAll(
  /\('(business|skill)', '([a-z0-9-]+)', '((?:[^']|'')+)', '((?:[^']|'')*)', (true|false), (true|false), (\d+)\)/g,
)].map((m, i) => ({
  id: `00000000-0000-4000-b000-${String(i + 1).padStart(12, "0")}`, kind: m[1] as "business" | "skill", slug: m[2], name: m[3].replace(/''/g, "'"),
  blurb: m[4].replace(/''/g, "'"), published: m[5] === "true", teen_hidden: m[6] === "true", has_course: false, sort_order: Number(m[7]),
}));
const idOf = (slug: string) => SEED.find((t) => t.slug === slug)!.id;

describe("the seed", () => {
  it("is the 24 businesses and 16 skills, five businesses hidden from teens", () => {
    expect(SEED.filter((t) => t.kind === "business")).toHaveLength(24);
    expect(SEED.filter((t) => t.kind === "skill")).toHaveLength(16);
    expect(SEED.filter((t) => t.teen_hidden).map((t) => t.slug).sort()).toEqual(["affiliate-marketing", "amazon-fba", "dropshipping", "online-coaching", "online-reselling"]);
    expect(SEED.every((t) => t.published)).toBe(true);
  });
});

// ============ The plan rules, one by one ============

const topics = (): TopicRow[] => SEED.map((t) => ({ ...t }));
let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString();
const pick = (picks: PickRow[], slug: string, plan: "trial" | "basic" | "pro", minor = false, ts = topics()) => applyPick(picks, ts, idOf(slug), "u1", plan, minor, at());
const active = (picks: PickRow[], kind: string) => picks.filter((p) => p.kind === kind && p.status === "active").map((p) => SEED.find((t) => t.id === p.topic_id)!.slug).sort();

describe("plan rules", () => {
  it("the trial and Basic share limits; Pro and the Owner's full access have Pro's; no plan has none", () => {
    expect(pickPlanOf("trial")).toBe("trial");
    expect(pickPlanOf("basic")).toBe("basic");
    expect(pickPlanOf("pro")).toBe("pro");
    expect(pickPlanOf("full")).toBe("pro");
    expect(pickPlanOf("none")).toBeNull();
  });

  for (const plan of ["basic", "trial"] as const) {
    describe(plan, () => {
      it(`allows ${SKILL_LIMIT_BASIC} active skills and refuses a 4th; a skill can be swapped`, () => {
        const p: PickRow[] = [];
        for (const s of ["copywriting", "negotiation", "public-speaking"]) expect(pick(p, s, plan).result).toBe("picked");
        expect(pick(p, "time-management", plan)).toEqual({ result: "limit", limit: 3, used: 3 });
        expect(applyPause(p, topics(), idOf("negotiation"), plan, false)).toMatchObject({ result: "paused" });
        expect(pick(p, "time-management", plan).result).toBe("picked");
        expect(active(p, "skill")).toEqual(["copywriting", "public-speaking", "time-management"]);
        expect(p.find((x) => x.topic_id === idOf("negotiation"))!.status).toBe("paused");
      });

      it("locks the business once chosen: no switching, no setting aside", () => {
        const p: PickRow[] = [];
        expect(pick(p, "seo-services", plan).result).toBe("picked");
        expect(p[0].locked).toBe(true);
        expect(pick(p, "newsletter", plan)).toMatchObject({ result: "locked" });
        expect(applyPause(p, topics(), idOf("seo-services"), plan, false)).toEqual({ result: "locked" });
        expect(active(p, "business")).toEqual(["seo-services"]);
      });
    });
  }

  describe("Pro", () => {
    it("allows any number of skills", () => {
      const p: PickRow[] = [];
      for (const s of SEED.filter((t) => t.kind === "skill")) expect(pick(p, s.slug, "pro").result).toBe("picked");
      expect(active(p, "skill")).toHaveLength(16);
    });

    it("keeps one active business; switching pauses the old one and keeps it (progress kept)", () => {
      const p: PickRow[] = [];
      pick(p, "youtube-channel", "pro");
      expect(pick(p, "newsletter", "pro")).toMatchObject({ result: "picked", previous: idOf("youtube-channel") });
      expect(active(p, "business")).toEqual(["newsletter"]);
      expect(p).toHaveLength(2);
      expect(p.every((x) => !x.locked)).toBe(true);
    });
  });

  describe("Pro to Basic", () => {
    it("keeps the active business (locked) and the 3 most recent skills, pauses the rest, deletes nothing", () => {
      const p: PickRow[] = [];
      const skills = SEED.filter((t) => t.kind === "skill").slice(0, 6).map((t) => t.slug);
      for (const s of skills) pick(p, s, "pro");
      pick(p, "print-on-demand", "pro");
      expect(reconcile(p, topics(), "basic", false)).toBe(3);
      expect(active(p, "skill")).toEqual(skills.slice(3).sort());
      expect(p).toHaveLength(7);
      expect(p.find((x) => x.kind === "business")).toMatchObject({ status: "active", locked: true });
      expect(reconcile(p, topics(), "basic", false)).toBe(0);
      reconcile(p, topics(), "pro", false);
      expect(p.find((x) => x.kind === "business")!.locked).toBe(false);
    });
  });

  describe("teens", () => {
    it("can't pick a teen_hidden topic; an adult can", () => {
      for (const s of ["amazon-fba", "dropshipping", "online-reselling", "affiliate-marketing", "online-coaching"]) {
        expect(pick([], s, "pro", true)).toEqual({ result: "not_available" });
        expect(pick([], s, "pro", false).result).toBe("picked");
      }
    });

    it("a pick on a topic later hidden from teens, or unpublished, is paused", () => {
      const p: PickRow[] = [];
      pick(p, "print-on-demand", "basic", true);
      const ts = topics();
      ts.find((t) => t.slug === "print-on-demand")!.teen_hidden = true;
      expect(reconcile(p, ts, "basic", true)).toBe(1);
      expect(p[0]).toMatchObject({ status: "paused", locked: false });
    });
  });
});

describe("the five answers and the best matches", () => {
  const A: PathAnswers = { goal: "freelance", hours: 5, experience: "none", style: "create", camera: "no" };

  it("accepts only the listed answers", () => {
    expect(checkPathAnswers({ ...A })).toEqual({ answers: A });
    expect(checkPathAnswers({ ...A, hours: "5" })).toEqual({ answers: A });
    expect(checkPathAnswers({ ...A, hours: 7 })).toHaveProperty("problem");
    expect(checkPathAnswers({ ...A, goal: "get rich" })).toHaveProperty("problem");
    expect(checkPathAnswers({ ...A, camera: undefined })).toHaveProperty("problem");
  });

  it("puts 5 best matches first; someone avoiding the camera doesn't get camera-first businesses", () => {
    const list = SEED.filter((t) => t.kind === "business").map((t) => ({ slug: t.slug, sortOrder: t.sort_order }));
    const ranked = rankBusinesses(list, A);
    expect(ranked).toHaveLength(24);
    const best = ranked.filter((r) => r.best).map((r) => r.slug);
    expect(best).toHaveLength(5);
    expect(ranked.slice(0, 5).every((r) => r.best)).toBe(true);
    expect(best).not.toContain("ugc-content");
    expect(best).not.toContain("youtube-channel");
    expect(scoreBusiness("faceless-content", A).score).toBeGreaterThan(scoreBusiness("youtube-channel", A).score);
    // A builder who likes the camera gets building first.
    const builder = rankBusinesses(list, { goal: "start", hours: 10, experience: "some", style: "build", camera: "yes" });
    expect(builder.slice(0, 5).map((r) => r.slug)).toContain("website-design");
    // No answers: the Owner's order, nothing flagged.
    expect(rankBusinesses(list, null).map((r) => r.slug)).toEqual(list.map((t) => t.slug));
  });
});

// ============ Through the routes ============

type Db = ReturnType<typeof seedFake>;
let db: Db;
const LEARNER = ROLE_ID.learner;

beforeEach(() => {
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  db = seedFake();
  fake.db = db;
  db.data.topics = SEED.map((t) => ({ ...t }));
  db.data.learner_picks = [];
  db.data.topic_interest = [];
  db.data.entitlements = [{ id: "e1", account_id: LEARNER, tier: "basic", valid_from: "2026-01-01T00:00:00Z", valid_until: null }];
});

async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey = "learner", body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
}
const chooser = async (role: RoleKey = "learner") => chooserFrom((await call(picksRoute, "GET", "/api/v1/learn/picks", role)).body)!;
const pickR = (slug: string, role: RoleKey = "learner") => call(picksRoute, "POST", "/api/v1/learn/picks", role, { slug });
const audit = (action: string) => db.data.audit_events.filter((e) => e.action === action);
const ANSWERS = { goal: "freelance", hours: 5, experience: "none", style: "create", camera: "no" };

describe("Choose your path (learner)", () => {
  it("shows the questions, every visible topic with Course coming, the plan note and the no-promise note", async () => {
    const c = await chooser();
    expect(c.plan).toBe("basic");
    expect(c.businesses).toHaveLength(24);
    expect(c.skills).toHaveLength(16);
    expect(c.businesses.every((b) => !b.hasCourse)).toBe(true);
    expect(c.skillCounter).toBe("0 of 3 skills used");
    expect(c.note).toBe("Results vary. Nothing here promises income.");
    expect(c.planNote).toMatch(/up to 3 skills .* 1 business.*only the Owner can change it/);
    expect(JSON.stringify(c)).not.toMatch(/guarantee|\bearn(ings)?\b|income (of|up)|\$\d/i);
  });

  it("saves the five answers on the profile, privately, then shows 5 best matches first", async () => {
    expect((await call(answersRoute, "PUT", "/api/v1/learn/picks/answers", "learner", { ...ANSWERS, camera: "maybe" })).status).toBe(400);
    const r = await call(answersRoute, "PUT", "/api/v1/learn/picks/answers", "learner", ANSWERS);
    expect(r.status).toBe(200);
    const c = chooserFrom(r.body)!;
    expect(c.answers).toEqual(ANSWERS);
    expect(c.businesses.slice(0, 5).every((b) => b.best)).toBe(true);
    expect(db.data.profiles.find((p) => p.account_id === LEARNER)).toMatchObject({ path_goal: "freelance", path_hours: 5, path_style: "create" });
    expect(audit("learn.path_answers.save")).toHaveLength(2);
    expect(JSON.stringify(audit("learn.path_answers.save"))).not.toMatch(/freelance|"create"/);
  });

  it("Basic: counts skills plainly, refuses a 4th with the counter, and lets one be swapped", async () => {
    for (const s of ["copywriting", "negotiation"]) expect((await pickR(s)).status).toBe(201);
    expect(chooserFrom((await pickR("public-speaking")).body)!.skillCounter).toBe("3 of 3 skills used");
    const r = await pickR("time-management");
    expect(r).toMatchObject({ status: 409, body: { reason: "You're using 3 of 3 skills. Set one aside to pick another, or Pro allows more." } });
    expect((await call(pauseRoute, "POST", "/api/v1/learn/picks/pause", "learner", { slug: "negotiation" })).status).toBe(200);
    expect((await pickR("time-management")).status).toBe(201);
    expect((await chooser()).skills.filter((s) => s.picked).map((s) => s.slug).sort()).toEqual(["copywriting", "public-speaking", "time-management"]);
    expect(audit("learn.picks.pick").filter((e) => e.result === "blocked")).toHaveLength(1);
  });

  it("Basic: the business locks once chosen, with the Owner-only note", async () => {
    expect((await pickR("seo-services")).status).toBe(201);
    const c = await chooser();
    expect(c.business).toEqual({ slug: "seo-services", name: "SEO services", locked: true, lockNote: "Only the Owner can change this." });
    expect(await pickR("newsletter")).toMatchObject({ status: 403, body: { reason: "Your business is locked. Only the Owner can change this." } });
    expect((await call(pauseRoute, "POST", "/api/v1/learn/picks/pause", "learner", { slug: "seo-services" })).status).toBe(403);
  });

  it("the trial has the Basic limits", async () => {
    db.data.entitlements[0].tier = "trial";
    for (const s of ["copywriting", "negotiation", "public-speaking"]) await pickR(s);
    expect((await pickR("time-management")).status).toBe(409);
    expect((await chooser()).planNote).toMatch(/^Free trial: up to 3 skills/);
  });

  it("Pro: unlimited skills, one business at a time, switching keeps the old one", async () => {
    db.data.entitlements[0].tier = "pro";
    for (const s of SEED.filter((t) => t.kind === "skill").slice(0, 6)) expect((await pickR(s.slug)).status).toBe(201);
    expect((await chooser()).skillCounter).toBe("6 skills chosen (no limit on Pro)");
    await pickR("youtube-channel");
    expect((await pickR("newsletter")).status).toBe(201);
    expect(audit("learn.picks.pick").at(-1)!.previous_value).toBe("business: YouTube channel (now paused, kept)");
    const c = await chooser();
    expect(c.business).toMatchObject({ slug: "newsletter", locked: false });
    expect(c.businesses.find((b) => b.slug === "youtube-channel")).toMatchObject({ picked: false, paused: true });
  });

  it("Pro to Basic: the next visit keeps the business (now locked) and 3 skills, pausing the rest", async () => {
    db.data.entitlements[0].tier = "pro";
    for (const s of SEED.filter((t) => t.kind === "skill").slice(0, 5)) await pickR(s.slug);
    await pickR("graphic-design");
    db.data.entitlements[0].tier = "basic";
    const c = await chooser();
    expect(c.skillCounter).toBe("3 of 3 skills used");
    expect(c.skills.filter((s) => s.paused)).toHaveLength(2);
    expect(c.business).toMatchObject({ slug: "graphic-design", locked: true });
    expect(db.data.learner_picks).toHaveLength(6);
  });

  it("teens never see or pick a teen_hidden topic", async () => {
    db.data.accounts.find((a) => a.id === LEARNER)!.is_minor = true;
    const c = await chooser();
    expect(c.businesses).toHaveLength(19);
    expect(c.businesses.map((b) => b.slug)).not.toContain("amazon-fba");
    expect(await pickR("amazon-fba")).toMatchObject({ status: 404, body: { reason: "That topic isn't available." } });
    expect(db.data.learner_picks).toHaveLength(0);
  });

  it("no plan: the topics show, but nothing is saved", async () => {
    db.data.entitlements = [];
    expect((await chooser()).planNote).toBe("Choose a plan or start the free trial to save picks.");
    expect((await pickR("copywriting")).status).toBe(403);
  });

  it("a topic with no course still saves the pick and adds anonymous demand for the day; one with a course doesn't", async () => {
    await pickR("copywriting");
    expect(db.data.topic_interest).toEqual([expect.objectContaining({ topic_id: idOf("copywriting"), count: 1 })]);
    expect(Object.keys(db.data.topic_interest[0]).some((k) => /account|user/.test(k))).toBe(false);
    db.data.topics.find((t) => t.slug === "negotiation")!.has_course = true;
    await pickR("negotiation");
    expect(db.data.topic_interest).toHaveLength(1);
  });

  it("a guardian has no picks (no learn capability)", async () => {
    expect((await call(picksRoute, "GET", "/api/v1/learn/picks", "guardian")).status).toBe(403);
  });
});

describe("/admin/topics", () => {
  it("the Owner, Super Admin and Course Admin see topics with demand; others can't", async () => {
    await pickR("copywriting");
    for (const role of ["owner", "superAdmin", "courseAdmin"] as const) {
      const r = adminTopicsFrom((await call(topicsRoute, "GET", "/api/v1/topics", role)).body)!;
      expect(r.topics).toHaveLength(40);
      expect(r.topics.find((t) => t.slug === "copywriting")).toMatchObject({ demand30: 1, demandAll: 1, activePicks: 1 });
    }
    for (const role of ["reviewer", "support", "learner", "guardian"] as const) expect((await call(topicsRoute, "GET", "/api/v1/topics", role)).status).toBe(403);
  });

  it("adds, edits, publishes, hides from teens, marks a course, and reorders: every change audited", async () => {
    const add = await call(topicsRoute, "POST", "/api/v1/topics", "courseAdmin", { kind: "skill", name: "Bookkeeping basics", blurb: "Track money in and out." });
    expect(add.status).toBe(201);
    const t = adminTopicsFrom(add.body)!.topics.find((x) => x.slug === "bookkeeping-basics")!;
    expect(t).toMatchObject({ published: false, teenHidden: false, hasCourse: false });
    expect((await call(topicRoute, "PATCH", `/api/v1/topics/${t.id}`, "courseAdmin", { published: true, hasCourse: true }, { id: t.id })).status).toBe(200);
    expect((await call(topicRoute, "PATCH", `/api/v1/topics/${t.id}`, "owner", { teenHidden: true }, { id: t.id })).status).toBe(200);
    expect(db.data.topics.find((x) => x.id === t.id)).toMatchObject({ published: true, has_course: true, teen_hidden: true });
    const skills = SEED.filter((x) => x.kind === "skill").map((x) => x.slug);
    const order = ["bookkeeping-basics", ...skills.reverse()];
    expect((await call(orderRoute, "PUT", "/api/v1/topics/order", "superAdmin", { kind: "skill", order })).status).toBe(200);
    expect((await call(orderRoute, "PUT", "/api/v1/topics/order", "superAdmin", { kind: "skill", order: order.slice(1) })).status).toBe(400);
    expect(db.data.topics.filter((x) => x.kind === "skill").sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map((x) => x.slug)).toEqual(order);
    const events = audit("topics.manage").filter((e) => e.result === "completed");
    expect(events.map((e) => e.context)).toEqual([
      'Added the skill "Bookkeeping basics".',
      'Edited the skill "Bookkeeping basics": published; has a course.',
      'Edited the skill "Bookkeeping basics": hidden from teens.',
      "Reordered the skill topics.",
    ]);
  });

  it("refuses income promises and attorney-approval claims in topic text", async () => {
    expect((await call(topicsRoute, "POST", "/api/v1/topics", "owner", { kind: "business", name: "Passive income machine" })).status).toBe(400);
    expect((await call(topicsRoute, "POST", "/api/v1/topics", "owner", { kind: "business", name: "Flipping", blurb: "Guaranteed $500 a week" })).status).toBe(400);
    expect((await call(topicsRoute, "POST", "/api/v1/topics", "owner", { kind: "skill", name: "Contracts", blurb: "Attorney-approved templates" })).status).toBe(400);
  });

  it("a reviewer can't change topics", async () => {
    expect((await call(topicsRoute, "POST", "/api/v1/topics", "reviewer", { kind: "skill", name: "X skill" })).status).toBe(403);
  });
});

describe("the Owner changes a learner's business", () => {
  it("looks the learner up, then changes the locked business with a reason, audited; or releases it", async () => {
    await pickR("seo-services");
    const found = learnerPicksFrom((await call(learnerRoute, "GET", "/api/v1/topics/learner?email=learner@example.com", "owner")).body)!;
    expect(found).toMatchObject({ found: true, accountId: LEARNER, plan: "basic", picks: [{ slug: "seo-services", locked: true, status: "active" }] });
    // A reason is required.
    expect((await call(learnerRoute, "POST", "/api/v1/topics/learner", "owner", { accountId: LEARNER, slug: "newsletter" })).status).toBe(400);
    const r = await call(learnerRoute, "POST", "/api/v1/topics/learner", "owner", { accountId: LEARNER, slug: "newsletter", reason: "Learner asked by email to switch" });
    expect(r.status).toBe(200);
    expect(learnerPicksFrom(r.body)).toMatchObject({ found: true, picks: [{ slug: "newsletter", locked: true, status: "active" }, { slug: "seo-services", status: "paused" }] });
    const e = audit("picks.override").filter((x) => x.result === "completed");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ reason: "Learner asked by email to switch", previous_value: "SEO services (now paused, kept)", new_value: "Newsletter business (locked)" });
    // Release: the learner may choose again, and it locks again.
    expect((await call(learnerRoute, "POST", "/api/v1/topics/learner", "owner", { accountId: LEARNER, slug: null, reason: "Let them choose again" })).status).toBe(200);
    expect((await chooser()).business).toBeNull();
    expect((await pickR("graphic-design")).status).toBe(201);
    expect((await chooser()).business).toMatchObject({ slug: "graphic-design", locked: true });
  });

  it("only the Owner: a Super Admin is refused, and the refusal is audited", async () => {
    for (const role of ["superAdmin", "courseAdmin", "support", "learner"] as const) {
      expect((await call(learnerRoute, "POST", "/api/v1/topics/learner", role, { accountId: LEARNER, slug: "newsletter", reason: "Trying to switch it" })).status).toBe(403);
      expect((await call(learnerRoute, "GET", "/api/v1/topics/learner?email=learner@example.com", role)).status).toBe(403);
    }
    expect(audit("picks.override").filter((e) => e.result === "blocked").length).toBeGreaterThanOrEqual(4);
  });

  it("the teen rule holds for the Owner too", async () => {
    db.data.accounts.find((a) => a.id === LEARNER)!.is_minor = true;
    expect((await call(learnerRoute, "POST", "/api/v1/topics/learner", "owner", { accountId: LEARNER, slug: "amazon-fba", reason: "Checking the teen rule" })).status).toBe(404);
  });
});
