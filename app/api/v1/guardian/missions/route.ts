import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { guardianRequests } from "@/lib/missions";

/** C2: a Guardian's open mission requests from their teens. */
export const GET = withCap("guardian.controls", async (_req, _ctx, account) => ok(await guardianRequests(account)));
