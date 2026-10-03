import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { addToOpenList, openList } from "@/lib/sources/library";

// The Owner's open-license list (L1). GET: the list. POST { title, url, licenseName, notes?, reason }: add (Owner only).
export const GET = withCap("sources.library.view", async () => ok({ items: await openList() }));

export const POST = withCap("sources.open_list.edit", async (_req, _ctx, account, x) => {
  const r = await addToOpenList(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
