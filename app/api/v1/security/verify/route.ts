import { withCap } from "@/lib/auth";
import { acknowledgeStep } from "@/lib/enforcement";
import { ok, refuse } from "@/lib/http";

// The Verify step: Clerk has just re-checked the second factor (withCap), so the step is complete.
export const POST = withCap("security.verify", async (_req, _ctx, account, x) => {
  if (!x.enforcement.needsVerify) return refuse(409, "There's nothing to verify right now.");
  await acknowledgeStep(account.id, "verify");
  await x.audit({
    action: "security.step.verify.completed", context: "Confirmed it's them with a second-factor check (Verify step).",
    target: { type: "account", id: account.id }, result: "Completed", sensitive: true,
  });
  return ok({ verified: true });
});
