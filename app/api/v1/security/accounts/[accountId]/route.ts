import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { loadTargetAccount, staffSecurity } from "@/lib/security-view";

// One account's devices, sessions, overlaps, signals, flags, steps and appeals. No payment details.
export const GET = withCap("security.inspect", async (_req, ctx) => {
  const { accountId } = (await ctx.params) as { accountId: string };
  const target = await loadTargetAccount(accountId);
  return target ? ok(await staffSecurity(target)) : refuse(404, "No such account.");
});
