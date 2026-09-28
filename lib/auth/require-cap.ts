import "server-only";
import { randomUUID } from "node:crypto";
import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { recordAudit, type AuditActor, type AuditInput } from "@/lib/audit";
import { ROLE_LABEL, decide, isSensitive, requiresReason, type Action, type Target } from "@/lib/caps";
import { getAuthContext, unauthorized, type Account, type AuthContext } from "./index";

export const REASON_MIN = 5;
export const REASON_MAX = 500;

const NO_STORE = { "Cache-Control": "no-store" };
export const forbidden = (reason: string) => Response.json({ error: "forbidden", reason }, { status: 403, headers: NO_STORE });
export const badRequest = (reason: string) => Response.json({ error: "invalid_request", reason }, { status: 400, headers: NO_STORE });

export const actorOf = (a: Account): AuditActor => ({ accountId: a.id, label: `${a.displayName} (${ROLE_LABEL[a.roleKey]})`, role: a.roleKey });

/** Writes an event without ever turning a refusal into an error: a failed write is logged loudly. */
async function recordQuietly(e: AuditInput) {
  try {
    await recordAudit(e);
  } catch (err) {
    console.error("[audit] could not record:", err instanceof Error ? err.message : err, JSON.stringify(e));
  }
}

/**
 * The capability check for one request. Returns null when allowed, otherwise the response to send:
 * 403 with a plain reason, recorded as Blocked / No change made; or Clerk's reverification response
 * when a sensitive action needs the second factor re-checked (not recorded: the client retries).
 */
export async function requireCap(
  ctx: AuthContext,
  action: Action,
  target?: Target,
  opts: { requestId?: string } = {},
): Promise<Response | null> {
  const { account } = ctx;
  const decision = decide({ role: account.roleKey, assignedCourses: account.assignedCourses }, action, target);
  if (!decision.allowed) {
    await recordQuietly({
      actor: actorOf(account),
      action,
      context: `Refused: ${decision.reason}`,
      target: target ? { type: "course", id: target.course, label: target.course } : null,
      result: "Blocked",
      requestId: opts.requestId,
    });
    return forbidden(decision.reason);
  }
  if (isSensitive(action) && !ctx.recentlyVerified()) {
    // The client (useReverification) asks for the second factor and retries.
    return reverificationErrorResponse("strict_mfa");
  }
  return null;
}

/** What a handler gets besides the request: the parsed body (without "reason"), the reason, and the recorder. */
export type Extras = {
  body: Record<string, unknown>;
  reason: string | null;
  requestId: string;
  /** Records this request's audit event. Call at most once; the fields not given are filled in. */
  audit: (e: Omit<AuditInput, "actor" | "requestId" | "reason"> & { reason?: string | null }) => Promise<void>;
};

type RouteCtx = { params: Promise<Record<string, string | string[]>> };
type Handler = (req: Request, ctx: RouteCtx, account: Account, extras: Extras) => Promise<Response>;

async function readBody(req: Request): Promise<Record<string, unknown> | "invalid"> {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Every /api/v1 route except /health is exported through this:
 *   no session → 401; no capability, wrong course, or the Owner Academy → 403 (recorded);
 *   an action that needs a reason and has none → 400 (recorded, nothing changes);
 *   a sensitive action without a recent second factor → Clerk reverification;
 *   then the handler. For actions that need a reason, exactly one audit event is written per
 *   request: the handler's, or, if it didn't record one, one derived from its response.
 */
export function withCap(
  action: Action,
  handler: Handler,
  opts: { target?: (req: Request, params: Record<string, string | string[]>) => Target } = {},
) {
  return async (req: Request, ctx: RouteCtx): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? req.headers.get("x-vercel-id") ?? randomUUID();
    const authCtx = await getAuthContext();
    if (!authCtx) return unauthorized();
    const { account } = authCtx;
    const params = ctx?.params ? await ctx.params : {};
    const target = opts.target?.(req, params);

    // Capability first: someone without it is refused before anything else about the request matters.
    const decision = decide({ role: account.roleKey, assignedCourses: account.assignedCourses }, action, target);
    if (!decision.allowed) return (await requireCap(authCtx, action, target, { requestId }))!;

    const raw = await readBody(req);
    const needsReason = requiresReason(action);
    let recorded = 0;
    const audit: Extras["audit"] = async (e) => {
      if (recorded++) throw new Error(`audit already recorded for this request (${action})`);
      await recordAudit({ ...e, actor: actorOf(account), requestId, reason: e.reason ?? reason });
    };

    if (raw === "invalid") {
      if (needsReason) await recordQuietly({ actor: actorOf(account), action, context: "Refused: the request body isn't valid JSON.", result: "Blocked", requestId });
      return badRequest("The request body isn't valid JSON.");
    }
    const { reason: rawReason, ...body } = raw;
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (needsReason && (reason.length < REASON_MIN || reason.length > REASON_MAX)) {
      const why = reason.length > REASON_MAX
        ? `The reason is too long (${REASON_MAX} characters at most).`
        : "Give a reason. It's recorded in the audit log.";
      await recordQuietly({ actor: actorOf(account), action, context: `Refused: ${why}`, result: "Blocked", requestId });
      return badRequest(why);
    }

    const verify = await requireCap(authCtx, action, target, { requestId });
    if (verify) return verify;

    const res = await handler(req, ctx, account, { body, reason: needsReason ? reason : reason || null, requestId, audit });
    if (needsReason && !recorded) {
      const ok = res.status < 400;
      let why = "";
      if (!ok) why = ((await res.clone().json().catch(() => ({}))) as { reason?: string }).reason ?? `HTTP ${res.status}`;
      await recordQuietly({
        actor: actorOf(account), action, requestId, reason,
        context: ok ? `Completed (HTTP ${res.status}).` : `Refused: ${why}`,
        result: ok ? "Completed" : "Blocked",
      });
    }
    res.headers.set("x-request-id", requestId);
    return res;
  };
}
