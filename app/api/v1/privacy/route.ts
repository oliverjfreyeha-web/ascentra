import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { privacyOverview } from "@/lib/privacy";

// The Privacy Center (B4): the documents and versions agreed to, optional consents, and requests with due dates.
export const GET = withCap("privacy.view", async (_req, _ctx, account) => ok(await privacyOverview(account)));
