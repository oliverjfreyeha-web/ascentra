import { withCap } from "@/lib/auth";
import { searchAudit } from "@/lib/audit";
import { parseAuditFilters } from "@/lib/audit-query";
import { ok } from "@/lib/http";

// Owner and Super Admin only: search the audit log by actor, action, target and date.
export const GET = withCap("audit.view", async (req) => {
  const filters = parseAuditFilters(new URL(req.url).searchParams);
  const events = await searchAudit(filters, 100);
  return ok({ events, next: events.length === 100 ? events[events.length - 1].seq : null });
});
