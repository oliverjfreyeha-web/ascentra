import { withCap } from "@/lib/auth";
import { ok, refuse } from "@/lib/http";
import { findTargetAccount } from "@/lib/security-view";

// Look an account up by exact email or id (Owner, Super Admin, Support).
export const GET = withCap("security.inspect", async (req) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const account = await findTargetAccount(q);
  return account ? ok({ account }) : refuse(404, "No account with that email.");
});
