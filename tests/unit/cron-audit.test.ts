import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../fixtures/fake-db";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => (fake.db as { client: unknown }).client }));

import { GET } from "@/app/api/cron/audit-verify/route";

const SECRET = "test-cron-secret-0123456789abcdefghij";
let db: ReturnType<typeof createFakeDb>;
const call = (auth?: string) => GET(new Request("http://localhost/api/cron/audit-verify", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  db = createFakeDb();
  fake.db = db;
});

describe("GET /api/cron/audit-verify (Vercel Cron)", () => {
  it.each([[undefined], ["Bearer wrong"], [`Bearer ${SECRET}x`], [SECRET]])("refuses authorization %j", async (auth) => {
    expect((await call(auth)).status).toBe(401);
    expect(db.data.audit_events).toHaveLength(0);
  });

  it("refuses everything when CRON_SECRET isn't set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("verifies the chain and records the run as a system event", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect((await res.json()).report).toMatchObject({ ok: true });
    expect(db.data.audit_events).toMatchObject([{ action: "audit.verify", actor_label: "System (scheduled verification)", result: "completed" }]);
  });
});
