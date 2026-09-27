import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Webhook } from "standardwebhooks";
import { TEST_ENV } from "../fixtures/env";
import { clerkUser } from "../fixtures/clerk-user";

const syncClerkUser = vi.hoisted(() => vi.fn(async () => "owner_seeded"));
const disableClerkUser = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/accounts", () => ({ syncClerkUser, disableClerkUser }));

import { POST } from "@/app/api/webhooks/clerk/route";

const URL_ = "http://localhost/api/webhooks/clerk";
const secretBytes = (secret: string) => secret.replace(/^whsec_/, "");

function signed(payload: unknown, { secret = TEST_ENV.CLERK_WEBHOOK_SIGNING_SECRET, at = new Date(), tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const id = "msg_test_1";
  const signature = new Webhook(secretBytes(secret)).sign(id, at, body);
  return new NextRequest(URL_, {
    method: "POST",
    body: tamper ? body.replace("owner@example.com", "attacker@example.com") : body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
      "svix-signature": signature,
    },
  });
}

const event = { type: "user.created", object: "event", data: clerkUser() };

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(TEST_ENV)) vi.stubEnv(k, v);
  syncClerkUser.mockClear();
  disableClerkUser.mockClear();
});

describe("POST /api/webhooks/clerk", () => {
  it("accepts a correctly signed event and syncs the user", async () => {
    const res = await POST(signed(event));
    expect(res.status).toBe(200);
    expect(syncClerkUser).toHaveBeenCalledWith(event.data, TEST_ENV.OWNER_EMAIL);
  });

  it("refuses an event signed with a different secret", async () => {
    const other = "whsec_" + Buffer.from("some-other-secret-entirely-000").toString("base64");
    const res = await POST(signed(event, { secret: other }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(syncClerkUser).not.toHaveBeenCalled();
  });

  it("refuses a body changed after signing", async () => {
    const res = await POST(signed(event, { tamper: true }));
    expect(res.status).toBe(400);
    expect(syncClerkUser).not.toHaveBeenCalled();
  });

  it("refuses a replayed event with an old timestamp", async () => {
    const res = await POST(signed(event, { at: new Date(Date.now() - 60 * 60 * 1000) }));
    expect(res.status).toBe(400);
    expect(syncClerkUser).not.toHaveBeenCalled();
  });

  it("refuses a request with no signature headers", async () => {
    const res = await POST(new NextRequest(URL_, { method: "POST", body: JSON.stringify(event) }));
    expect(res.status).toBe(400);
    expect(syncClerkUser).not.toHaveBeenCalled();
  });

  it("refuses to run without a signing secret configured", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    const res = await POST(signed(event));
    expect(res.status).toBe(500);
    expect(syncClerkUser).not.toHaveBeenCalled();
  });

  it("disables the Account on user.deleted", async () => {
    const res = await POST(signed({ type: "user.deleted", object: "event", data: { id: "user_1", deleted: true } }));
    expect(res.status).toBe(200);
    expect(disableClerkUser).toHaveBeenCalledWith("user_1");
  });
});
