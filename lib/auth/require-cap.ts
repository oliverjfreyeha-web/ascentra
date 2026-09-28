import "server-only";
import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { recordAuditEvent } from "@/lib/audit";
import { decide, isSensitive, type Action, type Target } from "@/lib/caps";
import { getAuthContext, unauthorized, type Account, type AuthContext } from "./index";

export function forbidden(reason: string): Response {
  return Response.json({ error: "forbidden", reason }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

/**
 * The capability check for one request. Returns null when allowed, otherwise the response to send:
 * 403 with a plain reason (and the refusal recorded), or Clerk's reverification response when a
 * sensitive action needs the second factor re-checked.
 */
export async function requireCap(ctx: AuthContext, action: Action, target?: Target): Promise<Response | null> {
  const { account } = ctx;
  const decision = decide({ role: account.roleKey, assignedCourses: account.assignedCourses }, action, target);
  if (!decision.allowed) {
    await recordAuditEvent({
      type: "capability.refused",
      actorAccountId: account.id,
      detail: `${account.roleKey} refused ${action}${target ? ` on ${target.course}` : ""}: ${decision.reason}`,
    });
    return forbidden(decision.reason);
  }
  if (isSensitive(action) && !ctx.recentlyVerified()) {
    // The client (useReverification) asks for the second factor and retries.
    return reverificationErrorResponse("strict_mfa");
  }
  return null;
}

type RouteCtx = { params: Promise<Record<string, string | string[]>> };
type Handler = (req: Request, ctx: RouteCtx, account: Account) => Promise<Response>;

/**
 * Every /api/v1 route except /health is exported through this: no session → 401; no capability,
 * wrong course, or the Owner Academy → 403; then the handler.
 */
export function withCap(
  action: Action,
  handler: Handler,
  opts: { target?: (req: Request, params: Record<string, string | string[]>) => Target } = {},
) {
  return async (req: Request, ctx: RouteCtx): Promise<Response> => {
    const authCtx = await getAuthContext();
    if (!authCtx) return unauthorized();
    const params = ctx?.params ? await ctx.params : {};
    const denied = await requireCap(authCtx, action, opts.target?.(req, params));
    if (denied) return denied;
    return handler(req, ctx, authCtx.account);
  };
}
