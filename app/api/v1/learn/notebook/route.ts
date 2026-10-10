import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { notebook } from "@/lib/notebook";

/** C2: the learner's private Notebook: auto-notes by category, "My ideas", and the AI summary setting. */
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await notebook(account)));
