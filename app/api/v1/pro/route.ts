import { withCap } from "@/lib/auth";
import { PRO_REQUIRED, hasPro, tierOf } from "@/lib/billing";
import { ok, refuse } from "@/lib/http";

/**
 * The Pro-only check every Pro page asks: 403 unless this account's entitlement, read from the
 * database on this request, is Pro (or the Owner's full access). Basic and trial accounts are refused.
 */
export const GET = withCap("learn", async (_req, _ctx, account) => {
  const { tier } = await tierOf(account);
  if (!hasPro(tier)) return refuse(403, PRO_REQUIRED);
  return ok({ tier });
});
