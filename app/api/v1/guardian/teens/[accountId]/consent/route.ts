import { withCap } from "@/lib/auth";
import { giveConsents } from "@/lib/guardians";
import { ok, refuse } from "@/lib/http";

/**
 * The Guardian agrees, for one teen, to the Teen Terms and the Minor Privacy Notice: one consent_records row each,
 * with the document version. Body: { agreed: { teen_terms: "v0.2", minor_privacy_notice: "v0.2" } }.
 */
export const POST = withCap("guardian.consent.give", async (_req, ctx, account, x) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const r = await giveConsents(account, accountId, x.body);
  await x.audit(r.event);
  return r.ok ? ok(r.body) : refuse(r.status, r.reason);
});
