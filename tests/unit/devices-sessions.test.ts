/**
 * F6 checks, through the real routes (database faked in memory, Clerk mocked):
 *   - a fourth device is refused until one is replaced (after a second-factor check);
 *   - a second active session pauses the first, and both see the notice;
 *   - a scripted sharing pattern raises the flag; one far-away sign-in doesn't; many accounts on one
 *     IP address don't;
 *   - Suspend can't be applied automatically or by Support;
 *   - an appeal reaches the review queue;
 *   - the Owner can't be locked out by any of the above.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));
const session = vi.hoisted(() => ({ userId: "user_learner" as string | null, sessionId: "sess_1", verified: true }));
const clerk = vi.hoisted(() => ({ revokeSession: vi.fn(async (id: string) => ({ id })) }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () =>
    session.userId
      ? { isAuthenticated: true, userId: session.userId, sessionId: session.sessionId, has: () => session.verified }
      : { isAuthenticated: false, userId: null },
  ),
  clerkClient: vi.fn(async () => ({ sessions: clerk })),
  reverificationErrorResponse: () =>
    Response.json({ clerk_error: { type: "forbidden", reason: "reverification-error" } }, { status: 403 }),
}));

import * as sessionRoute from "@/app/api/v1/session/route";
import * as continueRoute from "@/app/api/v1/session/continue/route";
import * as endRoute from "@/app/api/v1/session/end/route";
import * as devicesRoute from "@/app/api/v1/devices/route";
import * as replaceRoute from "@/app/api/v1/devices/replace/route";
import * as deviceRoute from "@/app/api/v1/devices/[id]/route";
import * as deviceSignOutRoute from "@/app/api/v1/devices/[id]/sign-out/route";
import * as verifyRoute from "@/app/api/v1/security/verify/route";
import * as appealsRoute from "@/app/api/v1/security/appeals/route";
import * as appealRoute from "@/app/api/v1/security/appeals/[id]/route";
import * as accountRoute from "@/app/api/v1/security/accounts/[accountId]/route";
import * as freeRoute from "@/app/api/v1/security/accounts/[accountId]/devices/[deviceId]/route";
import * as limitRoute from "@/app/api/v1/security/accounts/[accountId]/limit/route";
import * as suspendRoute from "@/app/api/v1/security/accounts/[accountId]/suspend/route";
import * as meRoute from "@/app/api/v1/me/route";
import { effectOf } from "@/lib/enforcement";
import { DEVICE_LIMIT, SESSION_LIVE_SECONDS, SHARING } from "@/lib/security-config";
import { scoreSignals } from "@/lib/sharing";
import { OTHER_DEVICE_NOTICE } from "@/lib/sessions";

const ID = {
  owner: "00000000-0000-4000-8000-000000000001",
  superAdmin: "00000000-0000-4000-8000-000000000002",
  support: "00000000-0000-4000-8000-000000000005",
  learner: "00000000-0000-4000-8000-000000000007",
} as const;
type Who = keyof typeof ID;
const REASON = "Reviewed the session history";
const T0 = new Date("2026-09-28T12:00:00.000Z");

let db: ReturnType<typeof createFakeDb>;
let clock = T0.getTime();
const at = (minutes: number) => {
  clock = T0.getTime() + minutes * 60_000;
  vi.setSystemTime(clock);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
  vi.stubEnv("OWNER_EMAIL", "owner@example.com");
  const extraLearners = Array.from({ length: 20 }, (_, i) => ({
    id: `00000000-0000-4000-9000-0000000000${String(i).padStart(2, "0")}`, clerk_user_id: `user_crowd${i}`, email: `crowd${i}@example.com`,
    email_verified: true, role: "learner", status: "active", password_enabled: false, two_factor_enabled: false,
  }));
  db = createFakeDb({
    accounts: [
      ...(Object.entries(ID) as [Who, string][]).map(([r, id]) => ({
        id, clerk_user_id: `user_${r}`, email: r === "owner" ? "owner@example.com" : `${r.toLowerCase()}@example.com`, email_verified: true,
        role: r === "owner" || r === "learner" ? r : "admin", status: "active", password_enabled: true, two_factor_enabled: true,
      })),
      ...extraLearners,
    ],
    role_assignments: [
      { id: "ra-sa", account_id: ID.superAdmin, role: "super_admin", scope: [], status: "active" },
      { id: "ra-su", account_id: ID.support, role: "support", scope: [], status: "active" },
    ],
  });
  fake.db = db;
  session.verified = true;
  clerk.revokeSession.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

// ============ Browsers ============

const GEO = {
  seattle: { "x-vercel-ip-country-region": "WA", "x-vercel-ip-country": "US", "x-vercel-ip-latitude": "47.61", "x-vercel-ip-longitude": "-122.33" },
  miami: { "x-vercel-ip-country-region": "FL", "x-vercel-ip-country": "US", "x-vercel-ip-latitude": "25.76", "x-vercel-ip-longitude": "-80.19" },
  tacoma: { "x-vercel-ip-country-region": "WA", "x-vercel-ip-country": "US", "x-vercel-ip-latitude": "47.25", "x-vercel-ip-longitude": "-122.44" },
} as const;
const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

/** One browser profile: its Clerk session and (once set) its device cookie. */
type Browser = { user: string; sid: string; ua: string; geo?: Record<string, string>; ip?: string; token?: string };
let sidN = 0;
const browser = (who: Who | string, ua = UA.windows, geo?: Record<string, string>, ip = "203.0.113.7"): Browser =>
  ({ user: who in ID ? `user_${who}` : who, sid: `sess_${++sidN}`, ua, geo, ip });

function request(b: Browser, method: string, body?: unknown) {
  session.userId = b.user;
  session.sessionId = b.sid;
  const headers: Record<string, string> = {
    "content-type": "application/json", "user-agent": b.ua, "x-forwarded-for": b.ip ?? "203.0.113.7", "x-real-ip": b.ip ?? "203.0.113.7", ...(b.geo ?? {}),
  };
  if (b.token) headers.cookie = `__Host-ascentra_device=${b.token}`;
  return new Request("http://localhost/api/v1/x", { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });
async function send(b: Browser, handler: (r: Request, c: ReturnType<typeof params>) => Promise<Response>, method: string, body?: unknown, p: Record<string, string> = {}) {
  const res = await handler(request(b, method, body), params(p));
  const cookie = res.headers.get("set-cookie");
  const m = cookie?.match(/__Host-ascentra_device=([A-Za-z0-9_-]+)/);
  if (m) b.token = m[1];
  const json = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: json, cookie };
}
const beat = (b: Browser) => send(b, sessionRoute.POST, "POST");
const newSid = () => `sess_${++sidN}`;
const DAY = 24 * 60;

/** Two people on one account: one in Seattle, one in Miami. */
const pair = (who: Who) => ({ home: browser(who, UA.windows, GEO.seattle), away: browser(who, UA.iphone, GEO.miami) });
/**
 * A day of sharing: three times, over the day, Miami opens ASCENTRA while Seattle is using it (three
 * overlaps, more than an hour apart), the first about 4,400 km from Seattle's last activity minutes
 * earlier (one distant sign-in).
 */
async function sharingDay(p: ReturnType<typeof pair>, day: number) {
  for (let k = 0; k < 3; k++) {
    at(day * DAY + k * 90);
    await beat(p.home);
    p.away.sid = newSid();
    await beat(p.away);
    await send(p.home, continueRoute.POST, "POST");
    await send(p.away, endRoute.POST, "POST");
  }
}

const devices = (id: string) =>
  (db.data.trusted_devices ?? []).filter((d) => d.account_id === id && d.trust_state === "trusted") as ({ id: string; name: string } & Record<string, unknown>)[];
const events = (action?: string | RegExp) =>
  db.data.audit_events.filter((e) => !action || (typeof action === "string" ? e.action === action : action.test(String(e.action))));
const steps = (id: string) => (db.data.enforcement_steps ?? []).filter((s) => s.account_id === id).map((s) => s.step);
const flags = (id: string) => (db.data.sharing_flags ?? []).filter((f) => f.account_id === id);
const signals = (id?: string) => (db.data.sharing_signals ?? []).filter((s) => !id || s.account_id === id);

// ============ Trusted devices ============

describe("trusted devices", () => {
  it(`registers a device on its first verified sign-in, up to ${DEVICE_LIMIT}, and sets an HttpOnly device cookie`, async () => {
    const b = browser("learner");
    const r = await beat(b);
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^__Host-ascentra_device=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
    expect(r.body.device).toMatchObject({ trusted: true, name: "Chrome on Windows", kind: "desktop" });
    expect(devices(ID.learner)).toHaveLength(1);
    // Only the hash is stored.
    expect(devices(ID.learner)[0].device_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.data)).not.toContain(b.token!);
    expect(events("devices.register")).toHaveLength(1);
    expect(events("devices.register")[0].device_id).toBe(devices(ID.learner)[0].id);
    // Later heartbeats don't register it again.
    await beat(b);
    expect(devices(ID.learner)).toHaveLength(1);
  });

  it("refuses a fourth device until one is replaced, after a second-factor check", async () => {
    const [a, b, c] = [browser("learner"), browser("learner", UA.iphone), browser("learner", UA.mac)];
    for (const x of [a, b, c]) {
      expect((await beat(x)).body.device.trusted).toBe(true);
      at(clock / 60_000 - T0.getTime() / 60_000 + 5); // sessions far enough apart not to overlap
    }
    const d = browser("learner", UA.windows);
    const held = await beat(d);
    expect(held.body.device).toEqual({ trusted: false, name: "Chrome on Windows", why: "full" });
    expect(held.body.devices).toHaveLength(3);
    expect(held.body.session).toBeNull();
    expect(devices(ID.learner)).toHaveLength(3);
    // The held sign-in is recorded once per Clerk session, not once per page load.
    await beat(d);
    expect(db.data.session_events.filter((e) => e.event_type === "sign_in_held")).toHaveLength(1);

    // Every other API refuses the untrusted device.
    const me = await send(d, meRoute.GET, "GET");
    expect(me.status).toBe(403);
    expect(me.body.error).toBe("device_not_trusted");

    // Replacing needs a fresh second factor: without it, Clerk's reverification response and nothing changes.
    const oldest = devices(ID.learner)[0];
    session.verified = false;
    const noMfa = await send(d, replaceRoute.POST, "POST", { replace: oldest.id });
    expect(noMfa.body.clerk_error).toMatchObject({ reason: "reverification-error" });
    expect(devices(ID.learner).map((x) => x.id)).toContain(oldest.id);
    expect(events("devices.replace")).toHaveLength(0);

    session.verified = true;
    const done = await send(d, replaceRoute.POST, "POST", { replace: oldest.id });
    expect(done.status).toBe(200);
    expect(devices(ID.learner)).toHaveLength(3);
    expect(devices(ID.learner).map((x) => x.id)).not.toContain(oldest.id);
    expect((await beat(d)).body.device.trusted).toBe(true);
    // The replacement is audited with the new device's id, and the replaced device was signed out.
    const ev = events("devices.replace")[0];
    expect(ev).toMatchObject({ result: "completed", previous_value: oldest.name, new_value: "Chrome on Windows", device_id: done.body.device });
    expect(clerk.revokeSession).toHaveBeenCalledWith(a.sid);
    expect(signals(ID.learner).map((s) => s.kind)).toEqual(["device_replacement"]);
    // The replaced browser is now a fourth device.
    expect((await beat(a)).body.device.trusted).toBe(false);
  });

  it("registers a new browser once even when its first requests arrive together", async () => {
    const b = browser("learner");
    await beat(b); // gets the cookie
    const again = await Promise.all([beat(b), beat(b), beat(b)]);
    expect(again.every((r) => r.body.device.trusted)).toBe(true);
    expect(devices(ID.learner)).toHaveLength(1);
  });

  it("lets the person sign a device out (it stays trusted) or remove it (its slot is free)", async () => {
    const [a, b] = [browser("learner"), browser("learner", UA.iphone)];
    await beat(a);
    at(5);
    await beat(b);
    const phone = devices(ID.learner).find((d) => d.name === "Safari on iPhone")!;
    const out = await send(a, deviceSignOutRoute.POST, "POST", undefined, { id: phone.id });
    expect(out.status).toBe(200);
    expect(clerk.revokeSession).toHaveBeenCalledWith(b.sid);
    expect(devices(ID.learner)).toHaveLength(2);
    expect((await beat(b)).body.session.state).toBe("ended");

    const rm = await send(a, deviceRoute.DELETE, "DELETE", undefined, { id: phone.id });
    expect(rm.status).toBe(200);
    expect(devices(ID.learner)).toHaveLength(1);
    expect(events("devices.remove")[0]).toMatchObject({ result: "completed", device_id: devices(ID.learner)[0].id });
    const own = await send(a, devicesRoute.GET, "GET");
    expect(own.body.devices).toHaveLength(1);
    expect(own.body.devices[0]).toMatchObject({ current: true });
  });

  it("puts the request's device id on every audit event it writes", async () => {
    const a = browser("learner");
    await beat(a);
    const dev = devices(ID.learner)[0].id;
    await send(a, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.owner }); // refused: recorded
    await send(a, deviceSignOutRoute.POST, "POST", undefined, { id: dev });
    for (const e of events().filter((e) => e.actor_account_id === ID.learner)) expect(e.device_id, String(e.action)).toBe(dev);
  });
});

// ============ One live session ============

describe("one live session per account", () => {
  it("a second device starting pauses the first; both show the notice; the person picks which continues", async () => {
    const [a, b] = [browser("learner", UA.windows, GEO.seattle), browser("learner", UA.iphone, GEO.tacoma)];
    expect((await beat(a)).body.session).toMatchObject({ state: "active", conflict: false, notice: null });
    at(1);
    const second = await beat(b);
    expect(second.body.session).toMatchObject({ state: "active", conflict: true, notice: OTHER_DEVICE_NOTICE });
    expect(second.body.session.others[0]).toMatchObject({ device: "Chrome on Windows", state: "paused" });
    const first = await beat(a);
    expect(first.body.session).toMatchObject({ state: "paused", notice: OTHER_DEVICE_NOTICE });
    expect(first.body.session.others[0]).toMatchObject({ device: "Safari on iPhone", state: "active" });
    expect(events("session.paused")).toHaveLength(1);
    expect(signals(ID.learner).map((s) => s.kind)).toEqual(["overlapping_sessions"]);

    // "Continue here" on the first device: it continues and the second pauses.
    const cont = await send(a, continueRoute.POST, "POST");
    expect(cont.body.session).toMatchObject({ state: "active", conflict: true });
    expect((await beat(b)).body.session).toMatchObject({ state: "paused", notice: OTHER_DEVICE_NOTICE });

    // "Sign out here" on the first: the second continues and the notice clears.
    await send(a, endRoute.POST, "POST");
    at(2);
    expect((await beat(b)).body.session).toMatchObject({ state: "active", conflict: false, notice: null });
    // One heartbeat-based session row per device session, with start, last heartbeat and end.
    const rows = db.data.session_events.filter((e) => e.event_type === "session");
    expect(rows.find((r) => r.clerk_session_id === a.sid)).toMatchObject({ state: "ended", end_reason: "signed_out", ended_at: expect.any(String) });
    expect(rows.find((r) => r.clerk_session_id === b.sid)).toMatchObject({ state: "active", started_at: expect.any(String), last_heartbeat_at: expect.any(String) });
  });

  it("a closed tab ends by timeout, so a later sign-in elsewhere doesn't pause anything or count as an overlap", async () => {
    const [a, b] = [browser("learner"), browser("learner", UA.iphone)];
    await beat(a);
    at(SESSION_LIVE_SECONDS / 60 + 1);
    expect((await beat(b)).body.session).toMatchObject({ state: "active", conflict: false });
    expect(db.data.session_events.find((r) => r.event_type === "session" && r.clerk_session_id === a.sid)).toMatchObject({ state: "ended", end_reason: "timed_out" });
    expect(signals(ID.learner)).toHaveLength(0);
    // Coming back to the tab starts a new session, which pauses the phone (a second device starting).
    expect((await beat(a)).body.session).toMatchObject({ state: "active", conflict: true });
  });

  it("switching back and forth between two windows counts as one overlap an hour, not one per switch", async () => {
    const [a, b] = [browser("learner"), browser("learner", UA.iphone)];
    for (let m = 0; m < 50; m += 5) {
      at(m);
      a.sid = newSid();
      await beat(a);
      b.sid = newSid();
      await beat(b);
    }
    expect(signals(ID.learner).map((s) => s.kind)).toEqual(["overlapping_sessions"]);
    expect(flags(ID.learner)).toHaveLength(0);
  });

  it("two tabs in one browser are one session, not an overlap", async () => {
    const a = browser("learner");
    await beat(a);
    await beat({ ...a });
    expect(db.data.session_events.filter((e) => e.event_type === "session")).toHaveLength(1);
    expect(signals()).toHaveLength(0);
  });
});

// ============ The sharing tracker ============

describe("the sharing tracker", () => {
  it("no single kind of signal can raise a flag, and an IP address isn't a signal at all", () => {
    for (const kind of Object.keys(SHARING.points) as (keyof typeof SHARING.points)[]) {
      expect(scoreSignals(Array.from({ length: 50 }, () => ({ kind, points: SHARING.points[kind] }))).flagged, kind).toBe(false);
    }
    expect(scoreSignals([
      { kind: "overlapping_sessions", points: 1 }, { kind: "overlapping_sessions", points: 1 },
      { kind: "distant_sign_ins", points: 2 }, { kind: "device_replacement", points: 1 },
    ])).toMatchObject({ total: 5, flagged: true });
    expect(Object.keys(SHARING.points)).not.toContain("ip_address");
  });

  it("a scripted sharing pattern raises the flag and starts Notice, automatically and with a reason", async () => {
    const p = pair("learner");
    await sharingDay(p, 0);
    const kinds = signals(ID.learner).map((s) => s.kind).sort();
    expect(kinds).toEqual(["distant_sign_ins", "overlapping_sessions", "overlapping_sessions", "overlapping_sessions"]);
    expect(flags(ID.learner)).toHaveLength(1);
    expect(flags(ID.learner)[0]).toMatchObject({ score: 5, threshold: SHARING.threshold, kinds: ["overlapping_sessions", "distant_sign_ins"] });
    expect(steps(ID.learner)).toEqual(["notice"]);
    expect(events("security.flag.raised")[0]).toMatchObject({
      actor_label: "System (sharing tracker)", result: "completed", reason: expect.stringMatching(/^Sharing score 5 reached the threshold of 5/),
    });
    expect(events("security.step.notice")[0]).toMatchObject({ reason: expect.stringMatching(/Repeated overlapping sessions.*Sign-ins too far apart/), new_value: "Notice" });
    // The same day's overlaps alone would not have been enough.
    expect(scoreSignals([1, 2, 3].map(() => ({ kind: "overlapping_sessions" as const, points: 1 }))).flagged).toBe(false);
  });

  it("one far-away sign-in is a signal but never a flag", async () => {
    const [a, b] = [browser("learner", UA.windows, GEO.seattle), browser("learner", UA.iphone, GEO.miami)];
    await beat(a);
    at(SESSION_LIVE_SECONDS / 60 + 1); // a has closed; no overlap
    await beat(b);
    expect(signals(ID.learner).map((s) => s.kind)).toEqual(["distant_sign_ins"]);
    expect(flags(ID.learner)).toHaveLength(0);
    expect(steps(ID.learner)).toEqual([]);
  });

  it("many accounts signing in from one IP address raise nothing", async () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = [browser(`user_crowd${i}`, UA.windows, GEO.seattle, "198.51.100.1"), browser(`user_crowd${i}`, UA.iphone, GEO.seattle, "198.51.100.1")];
      await beat(a);
      at(i * 10 + 5);
      await beat(b);
      at(i * 10 + 10);
    }
    expect(devices("00000000-0000-4000-9000-000000000000")).toHaveLength(2);
    expect(signals()).toHaveLength(0);
    expect(db.data.sharing_flags ?? []).toHaveLength(0);
    // And nothing stores the address.
    expect(JSON.stringify(db.data)).not.toContain("198.51.100.1");
  });

  it("a second flag moves Notice to Verify; nothing automatic goes past Verify", async () => {
    const p = pair("learner");
    await sharingDay(p, 0);
    await sharingDay(p, 2);
    expect(steps(ID.learner)).toEqual(["notice", "verify"]);
    // Verify not completed yet: another flag adds no step.
    await sharingDay(p, 4);
    expect(steps(ID.learner)).toEqual(["notice", "verify"]);
    expect(flags(ID.learner)).toHaveLength(3);
    // Pages ask for the second factor; passing it completes Verify (recorded).
    const v = await send(p.home, verifyRoute.POST, "POST");
    expect(v.status).toBe(200);
    expect(events("security.step.verify.completed")).toHaveLength(1);
    for (let d = 6; d < 20; d += 2) await sharingDay(p, d);
    expect(new Set(steps(ID.learner))).toEqual(new Set(["notice", "verify"]));
    expect(db.data.enforcement_steps.every((s) => s.automatic && (s.step === "notice" || s.step === "verify"))).toBe(true);
  });
});

// ============ Steps and appeals ============

describe("Limit, Suspend and appeals", () => {
  const staff = (who: Who) => {
    const b = browser(who);
    return beat(b).then(() => b);
  };
  async function atVerify() {
    const p = pair("learner");
    await sharingDay(p, 0);
    await sharingDay(p, 2);
    expect(steps(ID.learner)).toEqual(["notice", "verify"]);
    return p;
  }

  it("Suspend can't be applied automatically or by Support; Limit needs Support; Suspend needs a Super Admin after Limit", async () => {
    await atVerify();
    const support = await staff("support");
    const superAdmin = await staff("superAdmin");

    // Support can't suspend (refused, recorded, nothing changes).
    const s1 = await send(support, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });
    expect(s1.status).toBe(403);
    expect(events("security.suspend").at(-1)).toMatchObject({ result: "blocked", actor_account_id: ID.support });
    // A Super Admin can't skip Limit.
    const s2 = await send(superAdmin, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });
    expect(s2.status).toBe(409);
    // The Super Admin can't apply Limit (Support's step).
    expect((await send(superAdmin, limitRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner })).status).toBe(403);
    // No reason: 400, nothing changes.
    expect((await send(support, limitRoute.POST, "POST", {}, { accountId: ID.learner })).status).toBe(400);
    expect(steps(ID.learner)).toEqual(["notice", "verify"]);

    const lim = await send(support, limitRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });
    expect(lim.status).toBe(200);
    expect(events("security.limit").at(-1)).toMatchObject({ result: "completed", reason: REASON, new_value: "Limit", previous_value: "Verify" });
    // Limited: a new device can't register or replace one.
    const newDevice = browser("learner", UA.mac);
    expect((await beat(newDevice)).body.device).toMatchObject({ trusted: false, why: "limited" });

    // Support still can't suspend, even after Limit.
    expect((await send(support, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner })).status).toBe(403);
    const sus = await send(superAdmin, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });
    expect(sus.status).toBe(200);
    expect(steps(ID.learner)).toEqual(["notice", "verify", "limit", "suspend"]);
    // Only people applied Limit and Suspend, and every step carries a reason.
    for (const s of db.data.enforcement_steps) {
      expect(s.reason).toEqual(expect.any(String));
      if (s.step === "limit" || s.step === "suspend") expect([s.automatic, s.applied_by_account_id]).not.toEqual([true, null]);
    }
    for (const e of events(/^security\.(step|limit|suspend)/).filter((e) => e.result === "completed")) {
      expect(e.reason, String(e.action)).toEqual(expect.any(String));
    }
  });

  it("a suspended account can only appeal; the appeal reaches the review queue; Support can't decide a Suspend appeal", async () => {
    const p = await atVerify();
    const support = await staff("support");
    const superAdmin = await staff("superAdmin");
    await send(support, limitRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });
    await send(superAdmin, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.learner });

    // Suspending signed every session out; they sign in again on their trusted laptop.
    expect(clerk.revokeSession).toHaveBeenCalledWith(p.home.sid);
    const signedIn = { ...p.home, sid: newSid() };
    expect((await beat(signedIn)).body.enforcement).toMatchObject({ step: "suspend", suspended: true });
    expect((await send(signedIn, meRoute.GET, "GET")).body.error).toBe("account_suspended");

    const short = await send(signedIn, appealsRoute.POST, "POST", { text: "not me" });
    expect(short.status).toBe(400);
    const ap = await send(signedIn, appealsRoute.POST, "POST", { text: "My sister used my laptop once while visiting. It won't happen again." });
    expect(ap.status).toBe(201);
    const ref = ap.body.appeal.reference;
    expect(events("security.appeal.submit").at(-1)).toMatchObject({ result: "completed", reason: expect.stringMatching(/sister/) });

    const queue = await send(support, appealsRoute.GET, "GET");
    expect(queue.body.appeals.map((a: { reference: string }) => a.reference)).toContain(ref);
    const appealId = queue.body.appeals.find((a: { reference: string }) => a.reference === ref).id;
    // A learner can't read the queue.
    expect((await send(browser("user_crowd1"), appealsRoute.GET, "GET")).status).toBe(403);

    const bySupport = await send(support, appealRoute.POST, "POST", { decision: "accept", reason: REASON }, { id: appealId });
    expect(bySupport.status).toBe(403);
    expect(steps(ID.learner).at(-1)).toBe("suspend");
    const bySuper = await send(superAdmin, appealRoute.POST, "POST", { decision: "accept", reason: "Explanation is credible" }, { id: appealId });
    expect(bySuper.status).toBe(200);
    expect(steps(ID.learner).at(-1)).toBe("cleared");
    expect(events("support.appeal.decide").at(-1)).toMatchObject({ result: "completed", reason: "Explanation is credible", new_value: "Accepted" });
    expect((await send(signedIn, meRoute.GET, "GET")).status).toBe(200);
  });

  it("an appeal at Notice reaches the queue and Support can decide it", async () => {
    const p = pair("learner");
    await sharingDay(p, 0);
    const a = p.home;
    expect(steps(ID.learner)).toEqual(["notice"]);
    expect((await send(a, appealsRoute.POST, "POST", { text: "I was travelling with two devices and switched between them." })).status).toBe(201);
    const support = await staff("support");
    const q = await send(support, appealsRoute.GET, "GET");
    expect(q.body.appeals).toHaveLength(1);
    expect(q.body.appeals[0]).toMatchObject({ step: "Notice", status: "under_review", account: { email: "learner@example.com" } });
    const d = await send(support, appealRoute.POST, "POST", { decision: "decline", reason: "Pattern continued after notice" }, { id: q.body.appeals[0].id });
    expect(d.status).toBe(200);
    expect((await send(support, appealsRoute.GET, "GET")).body.appeals).toHaveLength(0);
  });

  it("Support can free a device slot with a reason (audited); the staff view has no payment details", async () => {
    const a = browser("learner");
    await beat(a);
    const support = await staff("support");
    const dev = devices(ID.learner)[0];
    expect((await send(support, freeRoute.DELETE, "DELETE", {}, { accountId: ID.learner, deviceId: dev.id })).status).toBe(400);
    const r = await send(support, freeRoute.DELETE, "DELETE", { reason: "Learner lost their laptop" }, { accountId: ID.learner, deviceId: dev.id });
    expect(r.status).toBe(200);
    expect(devices(ID.learner)).toHaveLength(0);
    expect(clerk.revokeSession).toHaveBeenCalledWith(a.sid);
    expect(events("support.device.free").at(-1)).toMatchObject({ result: "completed", reason: "Learner lost their laptop", device_id: devices(ID.support)[0].id });
    const view = await send(support, accountRoute.GET, "GET", undefined, { accountId: ID.learner });
    expect(view.status).toBe(200);
    expect(Object.keys(view.body).sort()).toEqual(["account", "appeals", "deviceLimit", "devices", "enforcement", "flags", "history", "overlaps", "score", "sessions", "signals"]);
    expect(JSON.stringify(view.body)).not.toMatch(/payment|card|processor|billing|subscription/i);
    // A learner can't open the staff view.
    expect((await send(browser("user_crowd2"), accountRoute.GET, "GET", undefined, { accountId: ID.learner })).status).toBe(403);
  });
});

// ============ The Owner can't be locked out ============

describe("the Owner can't be locked out", () => {
  it("registers the Owner's existing browsers on the first sign-in after deploy (PC, Incognito, phone)", async () => {
    const pc = browser("owner", UA.windows, GEO.seattle);
    const incognito = browser("owner", UA.windows, GEO.seattle);
    const phone = browser("owner", UA.iphone, GEO.seattle);
    for (const b of [pc, incognito, phone]) expect((await beat(b)).body.device.trusted).toBe(true);
    expect(devices(ID.owner)).toHaveLength(3);
    for (const b of [pc, incognito, phone]) expect((await send(b, meRoute.GET, "GET")).status).toBe(200);
  });

  it("with all 3 slots full, a new Incognito window replaces one after the second-factor check", async () => {
    for (const ua of [UA.windows, UA.windows, UA.iphone]) await beat(browser("owner", ua));
    const fresh = browser("owner", UA.windows);
    expect((await beat(fresh)).body.device).toMatchObject({ trusted: false, why: "full" });
    const r = await send(fresh, replaceRoute.POST, "POST", { replace: devices(ID.owner)[0].id });
    expect(r.status).toBe(200);
    expect((await send(fresh, meRoute.GET, "GET")).status).toBe(200);
  });

  it("repeated sharing flags only ever reach Notice and Verify for the Owner, and the Owner can always verify", async () => {
    const p = pair("owner");
    for (let d = 0; d < 12; d += 2) await sharingDay(p, d);
    expect(flags(ID.owner).length).toBeGreaterThanOrEqual(5);
    expect(new Set(steps(ID.owner))).toEqual(new Set(["notice", "verify"]));
    // At Verify the API still works for the Owner, and the check completes with the second factor.
    const now = { ...p.home, sid: newSid() };
    expect((await send(now, meRoute.GET, "GET")).status).toBe(200);
    expect((await send(now, verifyRoute.POST, "POST")).status).toBe(200);
  });

  it("nobody can Limit or Suspend the Owner, or free the Owner's device slots", async () => {
    await beat(browser("owner"));
    const support = browser("support");
    const superAdmin = browser("superAdmin");
    await beat(support);
    await beat(superAdmin);
    // Put the Owner at Verify so the step order isn't what refuses.
    db.data.enforcement_steps = [{ id: "s1", account_id: ID.owner, step: "verify", automatic: true, applied_by_account_id: null, reason: "Test flag", created_at: "2026-09-28T11:00:00.000Z", acknowledged_at: null, limit_until: null }];
    expect((await send(support, limitRoute.POST, "POST", { reason: REASON }, { accountId: ID.owner })).body.reason).toBe("The Owner can't be limited or suspended.");
    expect((await send(superAdmin, suspendRoute.POST, "POST", { reason: REASON }, { accountId: ID.owner })).status).toBe(403);
    expect((await send(support, freeRoute.DELETE, "DELETE", { reason: REASON }, { accountId: ID.owner, deviceId: devices(ID.owner)[0].id })).status).toBe(403);
    expect(devices(ID.owner)).toHaveLength(1);
    expect(steps(ID.owner)).toEqual(["verify"]);
  });

  it("even a Limit or Suspend row written straight into the database has no effect on the Owner", () => {
    const row = (step: string) => ({ id: "x", account_id: ID.owner, step, automatic: false, applied_by_account_id: ID.superAdmin, reason: "x", flag_id: null, limit_until: "2099-01-01T00:00:00Z", acknowledged_at: null, created_at: "2026-01-01" });
    expect(effectOf(row("limit") as never, "owner")).toMatchObject({ limited: false, suspended: false });
    expect(effectOf(row("suspend") as never, "owner")).toMatchObject({ limited: false, suspended: false });
    expect(effectOf(row("suspend") as never, "learner")).toMatchObject({ suspended: true });
  });

  it("the Owner can remove a device from /account and sign in on a new one", async () => {
    const bs = [browser("owner"), browser("owner", UA.iphone), browser("owner", UA.mac)];
    for (const b of bs) await beat(b);
    await send(bs[0], deviceRoute.DELETE, "DELETE", undefined, { id: devices(ID.owner)[2].id });
    expect((await beat(browser("owner"))).body.device.trusted).toBe(true);
  });
});
