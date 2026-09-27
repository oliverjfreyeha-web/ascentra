import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/health/route";
import { parseServerEnv } from "@/lib/env";

// Every required variable present and well-formed, but both keys wrong.
const WRONG_KEYS_ENV = {
  SUPABASE_URL: "https://ascentra-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "wrong-supabase-service-role-key",
  CLERK_SECRET_KEY: "sk_test_wrong_clerk_secret_key",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GET /api/v1/health with every variable present but wrong keys", () => {
  const calls: { url: string; headers: Headers }[] = [];

  beforeEach(() => {
    calls.length = 0;
    for (const [k, v] of Object.entries(WRONG_KEYS_ENV)) vi.stubEnv(k, v);
    // Stand-ins for the real services: each rejects the key it is given, as Supabase and Clerk do.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      calls.push({ url, headers });
      if (url.startsWith(`${WRONG_KEYS_ENV.SUPABASE_URL}/auth/v1/admin/users`)) {
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

  it("passes the startup environment check", () => {
    expect(() => parseServerEnv(process.env)).not.toThrow();
  });

  it("reports Disconnected for both Supabase and Clerk", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body.services.supabase).toMatchObject({
      status: "disconnected",
      label: "Disconnected",
      reason: "Auth admin call failed (401): Invalid API key",
    });
    expect(body.services.clerk).toMatchObject({
      status: "disconnected",
      label: "Disconnected",
      reason: "Backend API returned 401",
    });
    expect(body.services.supabase).not.toHaveProperty("evidence");
    expect(body.services.clerk).not.toHaveProperty("evidence");
  });

  it("gets Disconnected from a real call with the configured key, not from missing config", async () => {
    await GET();
    const supabase = calls.find((c) => c.url.includes("/auth/v1/admin/users"));
    const clerk = calls.find((c) => c.url.includes("api.clerk.com"));
    expect(supabase?.headers.get("apikey")).toBe(WRONG_KEYS_ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(clerk?.headers.get("authorization")).toBe(`Bearer ${WRONG_KEYS_ENV.CLERK_SECRET_KEY}`);
  });
});
