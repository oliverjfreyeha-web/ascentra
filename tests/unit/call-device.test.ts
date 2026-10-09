/**
 * R1: the device dead end. A page could call the API before this browser was registered as a trusted device (right after
 * sign-up, or on a first sign-in in a new or private window) and get "not one of your trusted devices" with nothing to
 * press. app/call.ts now runs the device check once and retries once; when every slot is in use it stops (the device
 * gate shows the replace screen) and never loops.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { call } from "@/app/call";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOT_TRUSTED = { error: "device_not_trusted", reason: "This browser isn't one of your trusted devices yet." };

afterEach(() => vi.unstubAllGlobals());

describe("call() and an untrusted browser", () => {
  it("registers the browser, then retries the request once", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`);
      if (url === "/api/v1/session") return res(200, { device: { trusted: true, name: "Chrome on Mac" }, added: { name: "Chrome on Mac", count: 1 } });
      return seen.filter((x) => x.endsWith("/api/v1/privacy")).length === 1 ? res(403, NOT_TRUSTED) : res(200, { requests: [] });
    }));
    const r = await call("GET", "/api/v1/privacy");
    expect(r).toMatchObject({ _status: 200, requests: [] });
    expect(seen).toEqual(["GET /api/v1/privacy", "POST /api/v1/session", "GET /api/v1/privacy"]);
  });

  it("with every slot in use, returns the refusal without retrying (the device gate shows the replace screen)", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`);
      return url === "/api/v1/session" ? res(200, { device: { trusted: false, why: "full" } }) : res(403, NOT_TRUSTED);
    }));
    expect(await call("GET", "/api/v1/devices")).toMatchObject({ _status: 403, error: "device_not_trusted" });
    expect(seen).toEqual(["GET /api/v1/devices", "POST /api/v1/session"]);
  });

  it("leaves every other answer alone, and never re-runs the device check for the device check itself", async () => {
    const f = vi.fn(async () => res(403, { error: "forbidden", reason: "No." }));
    vi.stubGlobal("fetch", f);
    expect((await call("POST", "/api/v1/billing/checkout", { plan: "basic" }))._status).toBe(403);
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn(async () => res(403, NOT_TRUSTED));
    vi.stubGlobal("fetch", g);
    await call("POST", "/api/v1/session");
    expect(g).toHaveBeenCalledTimes(1);
  });
});
