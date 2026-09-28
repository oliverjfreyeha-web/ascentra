import { withCap } from "@/lib/auth";
import { acknowledgeStep } from "@/lib/enforcement";
import { ok } from "@/lib/http";

// The person read the Notice.
export const POST = withCap("self.view", async (_req, _ctx, account) => ok({ acknowledged: await acknowledgeStep(account.id, "notice") }));
