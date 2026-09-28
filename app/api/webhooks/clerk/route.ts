import type { NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { disableClerkUser, syncClerkUser } from "@/lib/accounts";
import { readEnv } from "@/lib/env";

// Clerk → Postgres. Nothing in the body is trusted until the signature checks out.
export async function POST(req: NextRequest) {
  const signingSecret = readEnv("CLERK_WEBHOOK_SIGNING_SECRET");
  const ownerEmail = readEnv("OWNER_EMAIL");
  if (!signingSecret || !ownerEmail) return Response.json({ error: "not_configured" }, { status: 500 });

  let evt;
  try {
    evt = await verifyWebhook(req, { signingSecret });
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  switch (evt.type) {
    case "user.created":
    case "user.updated": {
      const outcome = await syncClerkUser(evt.data, ownerEmail);
      return Response.json({ ok: true, outcome });
    }
    case "user.deleted":
      if (evt.data.id) await disableClerkUser(evt.data.id);
      return Response.json({ ok: true, outcome: "disabled" });
    default:
      return Response.json({ ok: true, outcome: "ignored" });
  }
}
