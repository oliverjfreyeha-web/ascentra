import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { runRefreshQueue } from "@/lib/courses/refresh";

// Nightly (vercel.json crons): refresh queued courses and those past their refresh date, under the AI spend caps.
// Vercel calls it with "Authorization: Bearer <CRON_SECRET>"; the same header runs it by hand. It never changes what
// learners see: it writes change reports for a Reviewer.
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = readEnv("CRON_SECRET");
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // New courses start only in the first minute: one refresh can take a few minutes, and the function stops at 300 s.
  const summary = await runRefreshQueue({ budgetMs: 60_000 });
  return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
