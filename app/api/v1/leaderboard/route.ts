import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { leaderboard } from "@/lib/leaderboard";

/** C2: the leaderboard (nickname, rank and streak only). Teens see practice rivals (simulated) and their own row. */
export const GET = withCap("learn", async (_req, _ctx, account) => ok(await leaderboard(account)));
