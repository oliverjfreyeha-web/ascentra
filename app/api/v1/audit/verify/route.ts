import { withCap } from "@/lib/auth";
import { verifyAuditChain } from "@/lib/audit";
import { ok } from "@/lib/http";

// Owner only: walk the audit chain now and report any break. The run is recorded.
export const POST = withCap("audit.verify", async (_req, _ctx, _account, { audit }) => {
  const report = await verifyAuditChain();
  await audit({
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
  return ok({ report });
});
