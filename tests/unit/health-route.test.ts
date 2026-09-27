import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEALTH_RATE_LIMIT } from "@/app/api/v1/health/route";
import { parseServerEnv } from "@/lib/env";
import { resetHealthCacheForTests } from "@/lib/health";
import { TEST_ENV } from "../fixtures/env";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let ipSeq = 0;
const request = (ip = `203.0.113.${++ipSeq}`) =>
  new Request("http://localhost/api/v1/health", { headers: { "x-real-ip": ip } });

const calls: { url: string; headers: Headers }[] = [];

beforeEach(() => {
  calls.length = 0;
  resetHealthCacheForTests();
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  // Stand-ins for the real services: each rejects the key it is given, as Supabase and Clerk do.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.startsWith(`${TEST_ENV.SUPABASE_URL}/auth/v1/admin/users`)) {
      return json(401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
    }
    if (url === "https://api.clerk.com/v1/jwks") {
      return json(401, { errors: [{ code: "authentication_invalid", message: "Invalid authentication" }] });
    }
    throw new TypeError(`unexpected request to ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/v1/health with every variable present but wrong keys", () => {
  it("passes the startup environment check", () => {
    expect(() => parseServerEnv(process.env)).not.toThrow();
  });

  it("reports Disconnected for both Supabase and Clerk", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services.supabase).toMatchObject({
      status: "disconnected",
      label: "Disconnected",
      reason: "Auth admin call failed (401): Invalid API key",
    });
    expect(body.services.clerk).toMatchObject({ status: "disconnected", label: "Disconnected", reason: "Backend API returned 401" });
    expect(body.services.supabase).not.toHaveProperty("evidence");
    expect(body.services.clerk).not.toHaveProperty("evidence");
  });

  it("gets Disconnected from a real call with the configured key, not from missing config", async () => {
    await GET(request());
    const supabase = calls.find((c) => c.url.includes("/auth/v1/admin/users"));
    const clerk = calls.find((c) => c.url.includes("api.clerk.com"));
    expect(supabase?.headers.get("apikey")).toBe(TEST_ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(clerk?.headers.get("authorization")).toBe(`Bearer ${TEST_ENV.CLERK_SECRET_KEY}`);
  });
});

describe("GET /api/v1/health caching", () => {
  it("calls Supabase and Clerk once per cache window, however many requests arrive", async () => {
    const first = await (await GET(request())).json();
    expect(first.cached).toBe(false);
    expect(calls).toHaveLength(2);

    const rest = await Promise.all(Array.from({ length: 10 }, () => GET(request())));
    expect(calls).toHaveLength(2);
    for (const res of rest) {
      const body = await res.json();
      expect(body.cached).toBe(true);
      // A cached answer keeps the time of the real check.
      expect(body.services.clerk.checkedAt).toBe(first.services.clerk.checkedAt);
    }
  });

  it("lets shared caches reuse the answer for the same window", async () => {
    const res = await GET(request());
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
  });

  it("checks again once the window has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await GET(request());
      vi.setSystemTime(Date.now() + 31_000);
      await GET(request());
      expect(calls).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /api/v1/health rate limit", () => {
  it(`allows ${HEALTH_RATE_LIMIT.limit} requests a minute per client, then answers 429`, async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < HEALTH_RATE_LIMIT.limit; i++) expect((await GET(request(ip))).status).toBe(200);

    const limited = await GET(request(ip));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");

    // Other clients are unaffected.
    expect((await GET(request("198.51.100.8"))).status).toBe(200);
  });
});
