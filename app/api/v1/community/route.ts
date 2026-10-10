import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { community, setCommunity } from "@/lib/community";

/** C2: the community links (outside links, new tab), for everyone signed in; hidden from teens if the Owner says so. */
export const GET = withCap("self.view", async (_req, _ctx, account) => ok(await community(account)));

/** C2: the Owner sets the links. Body: { discordUrl, socialLinks, hideFromTeens }. Audited. */
export const PUT = withCap("community.manage", async (_req, _ctx, account, x) => {
  const r = await setCommunity(account, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body, r.status) : refuse(r.status, r.reason);
});
