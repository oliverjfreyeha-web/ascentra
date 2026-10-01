import { withCap } from "@/lib/auth";
import { guardianOverview } from "@/lib/guardians";
import { ok } from "@/lib/http";

// The Guardian Center: the Guardian's identity check, each linked teen and where they stand, and the teen documents.
export const GET = withCap("guardian.controls", async (_req, _ctx, account) => ok(await guardianOverview(account)));
