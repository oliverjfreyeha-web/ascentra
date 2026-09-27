import { describe, expect, it } from "vitest";
import { probeClerk, probeSupabase } from "@/lib/health";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const neverCalled: typeof fetch = () => {
  throw new Error("fetch should not be called");
};

describe("probeClerk", () => {
  it("is Disconnected with no key, without calling out", async () => {
    const s = await probeClerk({}, { fetch: neverCalled });
    expect(s).toMatchObject({ status: "disconnected", label: "Disconnected", reason: "Not configured" });
  });

  it("is Disconnected when the key is rejected", async () => {
    const s = await probeClerk({ secretKey: "sk_test_x" }, { fetch: async () => json(401, { errors: [] }) });
    expect(s).toMatchObject({ status: "disconnected", reason: "Backend API returned 401" });
  });

  it("is Disconnected when the network fails", async () => {
    const s = await probeClerk({ secretKey: "sk_test_x" }, { fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(s).toMatchObject({ status: "disconnected", reason: "fetch failed" });
  });

  it("is Disconnected when a 200 is not a JWKS", async () => {
    const s = await probeClerk({ secretKey: "sk_test_x" }, { fetch: async () => json(200, { hello: "proxy" }) });
    expect(s.status).toBe("disconnected");
  });

  it("is Disconnected on timeout", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const s = await probeClerk({ secretKey: "sk_test_x" }, { fetch: hang, timeoutMs: 20 });
    expect(s.status).toBe("disconnected");
  });

  it("is Connected only with a successful JWKS response, and carries evidence", async () => {
    let auth: string | null = null;
    const s = await probeClerk(
      { secretKey: "sk_test_x" },
      {
        fetch: async (_u, init) => {
          auth = new Headers(init?.headers).get("authorization");
          return json(200, { keys: [] });
        },
      },
    );
    expect(auth).toBe("Bearer sk_test_x");
    expect(s).toMatchObject({ status: "connected", label: "Connected" });
    expect(s.status === "connected" && s.evidence).toBeTruthy();
  });
});

describe("probeSupabase", () => {
  const config = { url: "https://example.supabase.co", serviceRoleKey: "service-key" };

  it("is Disconnected with no config, without calling out", async () => {
    expect(await probeSupabase({}, { fetch: neverCalled })).toMatchObject({ status: "disconnected", reason: "Not configured" });
    expect(await probeSupabase({ url: config.url }, { fetch: neverCalled })).toMatchObject({ status: "disconnected" });
  });

  it("is Disconnected when the key is rejected", async () => {
    const s = await probeSupabase(config, { fetch: async () => json(401, { message: "Invalid API key" }) });
    expect(s.status).toBe("disconnected");
  });

  it("is Disconnected when the network fails", async () => {
    const s = await probeSupabase(config, { fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(s.status).toBe("disconnected");
  });

  it("is Connected only when the admin call succeeds, sending the service key", async () => {
    let seen: { url: string; apikey: string | null } | undefined;
    const s = await probeSupabase(config, {
      fetch: async (u, init) => {
        seen = { url: String(u), apikey: new Headers(init?.headers).get("apikey") };
        return json(200, { users: [], aud: "authenticated" });
      },
    });
    expect(seen?.url).toContain("/auth/v1/admin/users");
    expect(seen?.apikey).toBe("service-key");
    expect(s).toMatchObject({ status: "connected", label: "Connected" });
  });
});
