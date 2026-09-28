import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { continueHere } from "@/lib/sessions";

// "Continue here": this device continues; the other live session pauses and shows the notice.
export const POST = withCap("self.view", async (_req, _ctx, account, x) => {
  if (!x.sessionId) return refuse(400, "No session.");
  const session = await continueHere(account.id, x.sessionId);
  if (!session) return refuse(409, "This session has ended. Reload the page.");
  await x.audit({
    action: "session.continue_here", context: `Continued on ${x.device.device?.name ?? "this device"}; ${session.others.length} other session(s) paused.`,
    target: { type: "account", id: account.id }, result: "Completed",
  });
  return ok({ session });
});
