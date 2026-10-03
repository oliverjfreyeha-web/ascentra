import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addFromOpenList, addFromUrl, listSources } from "@/lib/sources/library";

// The source library (L1). GET ?license=&status=&olderThanDays=: the ledger. POST: add by link, or from the open-license list.
export const GET = withCap("sources.library.view", async (req) => {
  const p = new URL(req.url).searchParams;
  return ok({ sources: await listSources({ license: p.get("license"), status: p.get("status"), olderThanDays: Number(p.get("olderThanDays")) || null }) });
});

/** Body: { url, title?, licenseClass, licenseName? } or { openListId }. The source starts as proposed. */
export const POST = withCap("sources.library.add", async (_req, _ctx, account, x) => {
  const r = x.body.openListId ? await addFromOpenList(account, x.body, x.requestId) : await addFromUrl(account, x.body, x.requestId);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
