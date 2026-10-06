import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { runCatalogQueue } from "@/lib/catalog";

// L6, nightly (vercel.json crons): advance the batch queue one course at a time, inside the AI spend caps, until a
// person is needed. Vercel calls it with "Authorization: Bearer <CRON_SECRET>"; the same header runs it by hand.
// Everything it writes is a Draft.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = readEnv("CRON_SECRET");
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // New steps start only in the first 150 s: one step can take a few minutes, and the function stops at 300 s.
  const summary = await runCatalogQueue({ budgetMs: 150_000 });
  return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
