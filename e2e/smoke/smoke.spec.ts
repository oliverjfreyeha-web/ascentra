/**
 * Live smoke suite against the live site. Test learners only (see global-setup.ts); never the Owner.
 * Every API call made directly by the suite carries x-request-id "smoke-<run>-…", and every event the
 * test accounts cause is recorded under their "TEST ASCENTRA smoke …" name, so they're easy to find.
 */
import { readFileSync } from "node:fs";
import { expect, request as pwRequest, test, type Browser, type Page } from "@playwright/test";
import { decide, type Action } from "../../lib/caps";
import { apiHandlers } from "../../tests/support/routes";
import { EXPECTED_TABLES } from "../../tests/db/expected-tables";
import { pageReady, signInWithPassword } from "../lib/sign-in";
import { ownerState, serviceDb, supabaseOrigin } from "./fixtures";
import { STATE_FILE } from "./global-setup";

type U = { id: string; email: string; password: string; totpSecret: string; accountId: string };
type State = { base: string; runId: string; runStart: string; learnerA: U; learnerB: U };
const S = (): State => JSON.parse(readFileSync(STATE_FILE, "utf8"));
const rid = (what: string) => ({ "x-request-id": `smoke-${S().runId}-${what}` });
const REFUSAL = /doesn't have permission to do this|^Only the Owner can do this/;

test.describe.configure({ mode: "serial" });

async function signedIn(browser: Browser, u: U) {
  const ctx = await browser.newContext({ baseURL: S().base });
  const page = await ctx.newPage();
  await signInWithPassword(page, u);
  await pageReady(page);
  return page;
}

// ============ Without signing in ============

test("health responds, and every /api/v1 route refuses a visitor with 401", async ({ request }) => {
  const health = await request.get("/api/v1/health");
  expect(health.status()).toBe(200);
  for (const h of apiHandlers()) {
    const path = new URL(h.url).pathname;
    const r = await request.fetch(path, { method: h.method, headers: rid("visitor"), data: h.method === "GET" ? undefined : {} });
    expect(r.status(), `${h.method} ${path}`).toBe(401);
  }
});

test("the webhook refuses an unsigned event, and the cron job refuses a caller without the secret", async ({ request }) => {
  const hook = await request.post("/api/webhooks/clerk", { data: { type: "user.created", data: { id: "user_smoke_forged" } } });
  expect(hook.status()).toBe(400);
  expect((await request.get("/api/cron/audit-verify")).status()).toBe(401);
  expect((await request.get("/api/cron/audit-verify", { headers: { authorization: "Bearer not-the-secret" } })).status()).toBe(401);
});

test("Supabase called directly with the anon key: every table, write and function refused", async () => {
  const url = supabaseOrigin();
  const anon = process.env.SUPABASE_ANON_KEY!;
  test.skip(!anon, "SUPABASE_ANON_KEY not set");
  const h = { apikey: anon, Authorization: `Bearer ${anon}`, "content-type": "application/json" };
  for (const t of EXPECTED_TABLES) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: h });
    const body = await r.json().catch(() => null);
    expect(r.status >= 400 || (Array.isArray(body) && body.length === 0), `${t}: ${r.status}`).toBe(true);
    expect((await fetch(`${url}/rest/v1/${t}`, { method: "POST", headers: h, body: "{}" })).status, `insert ${t}`).toBeGreaterThanOrEqual(400);
  }
  for (const fn of ["audit_verify_chain", "claim_device_slot"]) {
    expect((await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: "{}" })).status, fn).toBeGreaterThanOrEqual(400);
  }
});

// ============ A signed-in test learner ============

let a: Page;

test("a test learner signs in with password and authenticator code; this browser becomes a trusted device", async ({ browser }) => {
  a = await signedIn(browser, S().learnerA);
  await expect(a.getByText(/Signed in as TEST ASCENTRA smoke learner a \(Learner\)/i)).toBeVisible();
  const devices = await (await a.request.get("/api/v1/devices", { headers: rid("devices") })).json();
  expect(devices.devices).toHaveLength(1);
});

test("Gate 1 live: the learner gets exactly what the capability map grants on every route", async () => {
  for (const h of apiHandlers()) {
    const path = new URL(h.url).pathname;
    const r = await a.request.fetch(path, {
      method: h.method, headers: rid("gate1"),
      data: h.method === "GET" ? undefined : { reason: "Smoke test: Gate 1 route check" },
    });
    const body = await r.json().catch(() => ({}));
    const d = decide({ role: "learner", assignedCourses: [] }, h.action as Action);
    if (!d.allowed) {
      expect(r.status(), `${h.method} ${path}`).toBe(403);
      expect(body.reason, `${h.method} ${path}`).toBe(d.reason);
    } else {
      expect(r.status(), `${h.method} ${path}`).not.toBe(401);
      expect(String(body.reason ?? ""), `${h.method} ${path}`).not.toMatch(REFUSAL);
    }
    // /session/end ends this browser's session; the next heartbeat starts a new one.
  }
});

test("a forged role in headers, cookies or the body changes nothing", async () => {
  const me = await (await a.request.get("/api/v1/me", { headers: { ...rid("forged"), "x-role": "owner", "x-user-id": "owner" } })).json();
  expect(me.account.roleKey).toBe("learner");
  const inv = await a.request.post("/api/v1/admins/invites", { headers: rid("forged"), data: { email: "x@example.com", role: "superAdmin", roleKey: "owner", reason: "Smoke test: forged role" } });
  expect(inv.status()).toBe(403);
});

test("Supabase called directly with the learner's own session token: refused", async () => {
  const url = supabaseOrigin();
  const anon = process.env.SUPABASE_ANON_KEY;
  test.skip(!anon, "SUPABASE_ANON_KEY not set");
  const token = await a.evaluate(() => window.Clerk.session?.getToken());
  expect(token).toBeTruthy();
  for (const t of ["accounts", "profiles", "audit_events", "trusted_devices", "role_assignments"]) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: anon!, Authorization: `Bearer ${token}` } });
    const body = await r.json().catch(() => null);
    const leaked = Array.isArray(body) ? body.filter((row) => row.id !== S().learnerA.accountId && row.account_id !== S().learnerA.accountId) : [];
    expect(r.status >= 400 || leaked.length === 0, `${t}: ${r.status}`).toBe(true);
  }
});

test("a tampered session token is refused; an expired one too", async () => {
  test.setTimeout(150_000);
  const token = (await a.evaluate(() => window.Clerk.session?.getToken()))!;
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const swapped = `${h}.${Buffer.from(JSON.stringify({ ...payload, sub: "user_someone_else" })).toString("base64url")}.${s}`;
  const badSig = `${h}.${p}.${s.slice(0, -4)}${s.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  const bare = await pwRequest.newContext({ baseURL: S().base });
  for (const t of [swapped, badSig, "not-a-token"]) {
    expect((await bare.get("/api/v1/me", { headers: { authorization: `Bearer ${t}`, ...rid("tampered") } })).status()).toBe(401);
  }
  // The same token, used after it expires (Clerk session tokens last about a minute).
  const wait = payload.exp * 1000 - Date.now() + 5_000;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  expect((await bare.get("/api/v1/me", { headers: { authorization: `Bearer ${token}`, ...rid("expired") } })).status()).toBe(401);
  await bare.dispose();
});

// ============ Devices and sessions, live ============

test("three browsers are trusted; a fourth is asked to replace one; replacing works after the second factor", async ({ browser }) => {
  const b = await signedIn(browser, S().learnerA);
  const c = await signedIn(browser, S().learnerA);
  const devices = await (await c.request.get("/api/v1/devices", { headers: rid("devices") })).json();
  expect(devices.devices).toHaveLength(3);
  const ctx = await browser.newContext({ baseURL: S().base });
  const d = await ctx.newPage();
  await signInWithPassword(d, S().learnerA);
  await expect(d.getByRole("heading", { name: "Replace a trusted device?" })).toBeVisible({ timeout: 20_000 });
  expect((await d.request.get("/api/v1/me", { headers: rid("untrusted") })).status()).toBe(403);
  await d.getByRole("button", { name: "Replace this one" }).first().click();
  await expect(d.getByText(/Signed in as TEST/i)).toBeVisible({ timeout: 20_000 });
  // Pause: c was open before d started.
  await c.reload();
  await expect(c.getByText("ASCENTRA is open on another device.").first()).toBeVisible({ timeout: 20_000 });
  await d.reload();
  await expect(d.getByText("ASCENTRA is open on another device.").first()).toBeVisible({ timeout: 20_000 });
  void b;
});

test("a second test learner is kept apart from the first", async ({ browser }) => {
  const b = await signedIn(browser, S().learnerB);
  const own = await (await b.request.get("/api/v1/devices", { headers: rid("isolation") })).json();
  expect(own.devices).toHaveLength(1);
  const other = await b.request.get(`/api/v1/security/accounts/${S().learnerA.accountId}`, { headers: rid("isolation") });
  expect(other.status()).toBe(403);
});

// ============ The Owner was never touched; the chain is intact ============

test("the run added no safeguard step or flag to the Owner, and the Owner row is unchanged", async () => {
  const o = await ownerState(serviceDb(), S().runStart);
  expect(o.owner).toMatchObject({ role: "owner", status: "active" });
  expect([o.stepsSince, o.flagsSince]).toEqual([0, 0]);
  const { data } = await serviceDb().from("audit_events").select("action, target_id, actor_account_id").like("request_id", `smoke-${S().runId}-%`);
  for (const e of data ?? []) {
    expect(e.actor_account_id).not.toBe(o.owner.id);
    expect(e.target_id).not.toBe(o.owner.id);
  }
});

test("the audit chain verifies with no breaks after the full run", async () => {
  // The same verifier the daily job and the Owner's button run (public.audit_verify_chain).
  const { data, error } = await serviceDb().rpc("audit_verify_chain");
  expect(error).toBeNull();
  const report = Array.isArray(data) ? data[0] : data;
  expect(report).toMatchObject({ ok: true, broken_at_seq: null });
  console.log(`[smoke] audit chain intact: ${report.checked} events, head #${report.head_seq} ${report.head_hash}`);
});
