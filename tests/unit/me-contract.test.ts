/**
 * Pages learn who is signed in from GET /api/v1/me, which nests the account under `account`. L1's Source library
 * read `roleKey` from the top level, saw no role, and hid every Owner and Reviewer control. These tests tie the
 * pages' reader (app/me.ts) to the route's real answer, and make every page that calls /api/v1/me use that reader.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_ID, clerkIdOf, seedFake } from "../support/seed";
import { deviceCookie } from "../fixtures/devices";
import { TEST_ENV } from "../fixtures/env";
import type { RoleKey } from "@/lib/caps";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_owner" }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: true, userId: session.userId, sessionId: "sess_me", has: () => true })),
  clerkClient: vi.fn(async () => ({})),
  reverificationErrorResponse: () => Response.json({ clerk_error: { reason: "reverification-error" } }, { status: 403 }),
}));

import * as meRoute from "@/app/api/v1/me/route";
import { meFrom } from "@/app/me";

beforeEach(() => {
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  fake.db = seedFake();
});

async function me(role: RoleKey) {
  session.userId = clerkIdOf(role);
  const res = await meRoute.GET(new Request("https://ascentra.test/api/v1/me", { headers: { cookie: deviceCookie(ROLE_ID[role]) } }), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
  return res.json();
}

describe("reading /api/v1/me in the pages", () => {
  it("finds the role in the route's real answer, for each role that sees Source library controls", async () => {
    for (const role of ["owner", "reviewer", "superAdmin", "courseAdmin"] as const) {
      expect(meFrom(await me(role))?.roleKey, role).toBe(role);
    }
  });

  it("finds no role in the wrong shape (a top-level roleKey), so a page reading that shape would show it as signed out", () => {
    expect(meFrom({ roleKey: "owner" })).toBeNull();
    expect(meFrom(null)).toBeNull();
    expect(meFrom({ account: { roleKey: "owner", email: "o@example.com" } })?.roleKey).toBe("owner");
  });

  it("every page that calls /api/v1/me reads it through meFrom, never by hand", () => {
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return p === join("app", "api") ? [] : walk(p);
        return /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    })("app");
    const callers = files.filter((f) => /["'`]\/api\/v1\/me["'`]/.test(readFileSync(f, "utf8")));
    expect(callers.sort()).toEqual([
      "app/account-panel.tsx", "app/admin/audit/audit-log.tsx", "app/admin/catalog/topic-catalog.tsx", "app/admin/course-requests/request-queue.tsx", "app/admin/courses/[slug]/activity-library.tsx",
      "app/admin/courses/[slug]/course-builder.tsx", "app/admin/courses/course-list.tsx", "app/admin/safety/safety-queue.tsx", "app/admin/sources/source-library.tsx",
    ]);
    for (const f of callers) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/\bmeFrom\(/);
      expect(src, f).not.toMatch(/\.account\??\.roleKey|\bm\.roleKey\b|json\(\)\)?\.roleKey/);
    }
  });
});
