import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { readBillingEnv, stripeClient } from "@/lib/billing-env";
import { runAgeUp } from "@/lib/age-up";

// Daily (vercel.json crons): the 18th-birthday switch and its warnings. Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  const secret = readEnv("CRON_SECRET");
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const cfg = readBillingEnv();
  const summary = await runAgeUp(cfg.ok ? stripeClient(cfg.env) : null);
  return Response.json({ ok: true, ageUp: summary }, { headers: { "Cache-Control": "no-store" } });
}
