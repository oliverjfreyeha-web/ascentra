import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { myProgress } from "@/lib/progress/learner";

/** C2: "My progress": rank, streak, courses (with each module's state and reason), skills, scores over time. */
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await myProgress(account)));
