/**
 * I1 against real Postgres behind PostgREST, through the real routes: "Check file" reports problems with their paths
 * and writes nothing; "Create Draft" makes the Draft course in one transaction, and the course is then in the Owner's
 * editor and review checklist like any other Draft; a second import is the next Draft version; a published course is
 * refused; an admin or a learner is refused; every check and import is audited with the file's name, size and hash,
 * never its contents. Test-only data (the fake sample file).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startStack, type Stack } from "./stack";
import { OWNER_EMAIL, ROLE_ID, clerkIdOf, seedReal } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import { sampleCourse } from "../fixtures/course-import";
import type { RoleKey } from "@/lib/caps";

const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: `sess_${session.userId}`, has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as checkRoute from "@/app/api/v1/courses/import/check/route";
import * as createRoute from "@/app/api/v1/courses/import/route";
import * as studioRoute from "@/app/api/v1/courses/[slug]/studio/route";
import * as checklistRoute from "@/app/api/v1/review/checklist/route";
import { importResultFrom } from "@/app/import-api";
import { checklistFrom, studioFrom } from "@/app/studio-api";

let stack: Stack;
const q = (sql: string, p: unknown[] = []) => stack.db.client.query(sql, p);
async function call(mod: Record<string, unknown>, method: string, url: string, role: RoleKey, body?: unknown, params: Record<string, string> = {}) {
  session.userId = clerkIdOf(role);
  const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(new Request(`https://ascentra.test${url}`, {
    method, headers: { "content-type": "application/json", cookie: deviceCookie(ROLE_ID[role]) }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  const json = (await res.json()) as Record<string, unknown> & { reason?: string };
  return { status: res.status, body: json, reason: json.reason };
}
const file = (doc: unknown = sampleCourse(), fileName = "test-course.json") => ({ fileName, content: JSON.stringify(doc, null, 2) });
const check = (doc?: unknown, role: RoleKey = "owner") => call(checkRoute, "POST", "/api/v1/courses/import/check", role, file(doc));
const create = (doc?: unknown, role: RoleKey = "owner") => call(createRoute, "POST", "/api/v1/courses/import", role, file(doc));
const count = async (t: string) => (await q(`select count(*)::int as n from public.${t}`)).rows[0].n as number;

beforeAll(async () => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  stack = await startStack();
  vi.stubEnv("SUPABASE_URL", stack.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", stack.serviceKey);
  await seedReal(stack.db.client);
}, 60_000);
afterAll(() => stack?.stop());

describe("I1 on the real database", () => {
  it("Check file reports every problem with its path and writes nothing (but the audit record)", async () => {
    const bad = sampleCourse();
    bad.modules[2].items[4].sourceIds = ["s9"];
    bad.modules[1].lessons[0].sections[0].paragraphs[0].text = "Do this and you will earn $5,000 a month.";
    const before = await count("courses");
    const r = importResultFrom((await check(bad)).body)!;
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => `${p.path}: ${p.message}`)).toEqual(expect.arrayContaining([
      'modules[2].items[4].sourceIds[0]: unknown source "s9"',
      'modules[1].lessons[0].sections[0].paragraphs[0].text: reads as a promise to make or earn money: "earn $5,000". Reword it.',
    ]));
    expect(await count("courses")).toBe(before);
    expect(await count("sources")).toBe(0);
  });

  it("a clean check says what would be created; Create Draft makes it, and it shows in the editor and the checklist", async () => {
    const c = importResultFrom((await check()).body)!;
    expect(c).toMatchObject({ ok: true, summary: { topic: "Freelance graphic design", modules: 3, videoSlots: 3, items: { quiz: 3 }, resources: 2, resourcesHidden: 1 } });
    const r = await create();
    expect(r.status).toBe(201);
    const made = importResultFrom(r.body)!;
    expect(made.created).toMatchObject({ version: 1, academySlug: "graphic-design", editor: "/admin/courses/graphic-design", checklist: "/admin/review" });
    const s = studioFrom((await call(studioRoute, "GET", "/api/v1/courses/graphic-design/studio", "owner", undefined, { slug: "graphic-design" })).body)!;
    expect(s.version).toMatchObject({ status: "draft", ownerReviewRequired: true, isDraft: true });
    expect(s.modules).toHaveLength(3);
    expect(s.modules[0].items.map((i) => i.type).sort()).toEqual(["multiple_choice", "ordering", "short_answer", "spot_the_mistake"]);
    expect(s.emptySlots).toBe(3);
    expect(s.canPublish).toBe(false);
    const list = checklistFrom((await call(checklistRoute, "GET", "/api/v1/review/checklist", "owner")).body)!;
    expect(list.courses.find((x) => x.slug === "graphic-design")).toMatchObject({ approved: 0, modules: 3, income: { ok: true } });
  });

  it("importing again makes the next Draft version and leaves the first", async () => {
    expect(importResultFrom((await create()).body)!.created).toMatchObject({ version: 2 });
    expect((await q("select version, status from public.courses c join public.academies a on a.id = c.academy_id where a.slug = 'graphic-design' order by version")).rows)
      .toEqual([{ version: 1, status: "draft" }, { version: 2, status: "draft" }]);
  });

  it("a topic with a published course is refused, and the published version is untouched", async () => {
    await q("update public.courses set status = 'published', published_at = now() where version = 1 and academy_id = (select id from public.academies where slug = 'graphic-design')");
    const before = await count("courses");
    const r = await create();
    expect(r.status).toBe(422);
    expect(importResultFrom(r.body)!.problems[0].message).toMatch(/already has a published course/);
    expect(await count("courses")).toBe(before);
  });

  it("only the Owner: an admin, a reviewer or a learner is refused", async () => {
    for (const role of ["superAdmin", "courseAdmin", "reviewer", "learner"] as RoleKey[]) {
      expect((await check(sampleCourse("seo-services"), role)).status).toBe(403);
      expect((await create(sampleCourse("seo-services"), role)).status).toBe(403);
    }
    expect((await q("select count(*)::int as n from public.courses c join public.academies a on a.id = c.academy_id where a.slug = 'seo-services'")).rows[0].n).toBe(0);
  });

  it("every check and import is audited with the file name, size and hash, never the contents", async () => {
    const rows = (await q("select action, result, context, previous_value, new_value from public.audit_events where action like 'courses.import%' order by occurred_at")).rows;
    expect(rows.map((r) => `${r.action} ${r.result}`)).toEqual(expect.arrayContaining(["courses.import.check blocked", "courses.import.check completed", "courses.import completed", "courses.import blocked"]));
    const created = rows.find((r) => r.action === "courses.import" && r.result === "completed")!;
    expect(created.context).toMatch(/^Imported "test-course\.json" \(\d+ KB, sha256 [0-9a-f]{16}…\) for the topic "Freelance graphic design" as a Draft, version 1: 3 modules/);
    const all = JSON.stringify(rows);
    expect(all).not.toMatch(/Test paragraph|Test sample|one clear message per page/);
    expect((await q("select ok from public.audit_verify_chain()")).rows[0].ok).toBe(true);
  });
});
