import { timingSafeEqual } from "node:crypto";
import { SYSTEM_ACTOR, recordAudit, verifyAuditChain } from "@/lib/audit";
import { readEnv } from "@/lib/env";

// Daily chain verification (vercel.json crons). Vercel calls it with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  const secret = readEnv("CRON_SECRET");
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const report = await verifyAuditChain();
  await recordAudit({
    actor: SYSTEM_ACTOR("scheduled verification"),
    action: "audit.verify",
    context: report.ok
      ? `The audit chain is intact: ${report.checked} event(s), head #${report.headSeq}.`
      : `The audit chain is broken at #${report.brokenAtSeq}: ${report.problem}`,
    target: { type: "audit_log", id: "audit_events", label: "Audit log" },
    next: report.headHash,
    result: "Completed",
    status: report.ok ? "Recorded" : "Chain break reported",
    sensitive: !report.ok,
  });
  if (!report.ok) console.error("[audit] CHAIN BROKEN", JSON.stringify(report));
  return Response.json({ report }, { headers: { "Cache-Control": "no-store" } });
}
