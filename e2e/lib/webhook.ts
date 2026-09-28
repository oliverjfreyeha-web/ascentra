import { randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";

/**
 * Delivers a Clerk user event to the app's webhook, signed the way Clerk (Svix) signs it. Used where
 * Clerk can't reach the app (a local server in CI): the payload is the real user JSON from Clerk.
 */
export async function deliverUserEvent(baseUrl: string, secret: string, type: "user.created" | "user.updated", data: unknown) {
  const body = JSON.stringify({ type, object: "event", data });
  const id = `msg_e2e_${randomBytes(8).toString("hex")}`;
  const at = new Date();
  const signature = new Webhook(secret.replace(/^whsec_/, "")).sign(id, at, body);
  const res = await fetch(`${baseUrl}/api/webhooks/clerk`, {
    method: "POST", body,
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(Math.floor(at.getTime() / 1000)), "svix-signature": signature },
  });
  const json = (await res.json().catch(() => ({}))) as { outcome?: string; error?: string };
  if (!res.ok) throw new Error(`webhook ${type} failed: ${res.status} ${JSON.stringify(json)}`);
  return json.outcome;
}
