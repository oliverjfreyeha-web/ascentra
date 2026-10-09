import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { reviewChecklist } from "@/lib/courses/owner-review";

/** C1: the Owner's review checklist: modules waiting, sent back, empty video slots, and the income-claims check. */
export const GET = withCap("courses.view", async (_req, _ctx, account) => {
  if (account.roleKey !== "owner") return refuse(403, "The review checklist is the Owner's.");
  return ok(await reviewChecklist(account));
});
