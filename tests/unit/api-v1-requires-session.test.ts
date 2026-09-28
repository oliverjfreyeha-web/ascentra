import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// No session at all, and a database that must never be reached before auth.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ isAuthenticated: false, userId: null })),
  clerkClient: vi.fn(() => {
    throw new Error("Clerk reached without a session");
  }),
  reverificationErrorResponse: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("database reached without a session");
  },
}));

const API_ROOT = "app/api/v1";
const PUBLIC_ROUTES = new Set(["app/api/v1/health/route.ts"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return findRouteFiles(p);
    return /^route\.(ts|tsx|js)$/.test(name) ? [p] : [];
  });
}

// "[id]" → "test-id", "[...slug]" → "a/b": a plausible URL for any dynamic segment.
function samplePath(file: string) {
  const params: Record<string, string | string[]> = {};
  const path = relative("app", file)
    .replace(/\/route\.\w+$/, "")
    .split("/")
    .map((seg) => {
      const m = seg.match(/^\[(?:\[)?(\.\.\.)?(\w+)\]?\]$/);
      if (!m) return seg;
      params[m[2]] = m[1] ? ["a", "b"] : `test-${m[2]}`;
      return m[1] ? "a/b" : `test-${m[2]}`;
    })
    .join("/");
  return { url: `http://localhost/${path}`, params };
}

const routeFiles = findRouteFiles(API_ROOT);
const protectedRoutes = routeFiles.filter((f) => !PUBLIC_ROUTES.has(f));

describe("every /api/v1 route requires a session", () => {
  it("finds the routes by itself", () => {
    expect(routeFiles).toContain("app/api/v1/health/route.ts");
    expect(protectedRoutes.length).toBeGreaterThan(0);
  });

  it.each(protectedRoutes)("%s exports every method through withCap (a capability check)", (file) => {
    const src = readFileSync(file, "utf8");
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);
    for (const method of exported) {
      expect(src, `${file} ${method}`).toMatch(new RegExp(`export const ${method} = withCap\\(`));
    }
  });

  describe.each(protectedRoutes)("%s", (file) => {
    let mod: Record<string, unknown>;
    beforeAll(async () => {
      mod = await import(/* @vite-ignore */ `../../${file}`);
    });

    it("exports at least one HTTP method", () => {
      expect(METHODS.some((m) => typeof mod[m] === "function")).toBe(true);
    });

    it.each(METHODS)("%s without a session → 401 and nothing else", async (method) => {
      const handler = mod[method] as ((req: Request, ctx: unknown) => Promise<Response>) | undefined;
      if (!handler) return;
      const { url, params } = samplePath(file);
      const body = ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : JSON.stringify({ probe: true });
      const res = await handler(new Request(url, { method, body, headers: { "content-type": "application/json" } }), {
        params: Promise.resolve(params),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });
});
