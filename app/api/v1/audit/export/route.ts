import { withCap } from "@/lib/auth";
import { searchAudit, toCsv } from "@/lib/audit";
import { parseAuditFilters } from "@/lib/audit-query";

const MAX_ROWS = 5000;

// Owner and Super Admin only: export the (filtered) audit log as CSV. Needs a reason; the export is itself recorded.
export const POST = withCap("audit.export", async (_req, _ctx, _account, { body, audit }) => {
  const filters = parseAuditFilters(body);
  const events = await searchAudit(filters, MAX_ROWS);
  const described = Object.entries(filters).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(", ") || "no filters";
  await audit({
    action: "audit.export",
    context: `Exported ${events.length} audit event(s) as CSV (${described}).`,
    target: { type: "audit_log", id: "audit_events", label: "Audit log" },
    result: "Completed",
    sensitive: true,
  });
  return new Response(toCsv(events), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ascentra-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
