import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { retrieve } from "@/lib/sources/claims";

/** Retrieval (L1): ?q=<topic>&limit=. Approved passages only, each with its source and license. */
export const GET = withCap("sources.search", async (req, _ctx, account, x) => {
  const p = new URL(req.url).searchParams;
  const q = p.get("q") ?? "";
  if (!q.trim()) return refuse(400, "Give a topic to search for.");
  return ok(await retrieve(q, { limit: Number(p.get("limit")) || 8, accountId: account.id, requestId: x.requestId }));
});
