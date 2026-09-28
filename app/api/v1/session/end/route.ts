import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { endSession } from "@/lib/sessions";

// Sent before Clerk signs this browser out. If another device was paused, it continues.
export const POST = withCap("self.view", async (_req, _ctx, account, x) => {
  const ended = x.sessionId ? await endSession(account.id, x.sessionId, "signed_out") : false;
  return ok({ ended });
}, { device: "any", allowSuspended: true });
