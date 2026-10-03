import { timingSafeEqual } from "node:crypto";
import { readEnv } from "@/lib/env";
import { sendScheduledNotices } from "@/lib/notices";

// Daily (vercel.json crons): trial-ending and renewal reminders. Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  const secret = readEnv("CRON_SECRET");
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const counts = await sendScheduledNotices();
  return Response.json({ ok: true, notices: counts }, { headers: { "Cache-Control": "no-store" } });
}
