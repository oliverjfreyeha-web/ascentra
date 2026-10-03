import { withCap } from "@/lib/auth";
import { ok } from "@/lib/http";
import { estimates } from "@/lib/courses/admin";

// L2: the spend estimate shown before a run (?lessons=N), with the caps and what is left of them.
export const GET = withCap("courses.view", async (req) => {
  const n = Number(new URL(req.url).searchParams.get("lessons"));
  return ok(await estimates(Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 0));
});
