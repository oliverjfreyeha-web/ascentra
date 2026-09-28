import "server-only";
import { randomUUID } from "node:crypto";
import { reverificationErrorResponse } from "@clerk/nextjs/server";
import { recordAudit, type AuditActor, type AuditInput } from "@/lib/audit";
import { ROLE_LABEL, decide, isSensitive, requiresReason, type Action, type Target } from "@/lib/caps";
import { resolveDevice, type RequestDevice } from "@/lib/devices";
import { NO_ENFORCEMENT, currentEnforcement, type Enforcement } from "@/lib/enforcement";
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
  opts: { requestId?: string; deviceId?: string | null } = {},
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
      deviceId: opts.deviceId ?? null,
    });
    return forbidden(decision.reason);
  }
  if (isSensitive(action) && !ctx.recentlyVerified()) {
    // The client (useReverification) asks for the second factor and retries.
    return reverificationErrorResponse("strict_mfa");
  }
  return null;
}

/**
 * What a handler gets besides the request: the parsed body (without "reason"), the reason, the request's
 * device and safeguard step, the Clerk session id, and the recorder.
 */
export type Extras = {
  body: Record<string, unknown>;
  reason: string | null;
  requestId: string;
  sessionId: string | null;
  device: RequestDevice;
  enforcement: Enforcement;
  /** Records this request's audit event. Call at most once; the fields not given are filled in. */
  audit: (e: Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId"> & { reason?: string | null; deviceId?: string | null }) => Promise<void>;
};

export const DEVICE_NOT_TRUSTED =
  "This device isn't one of your trusted devices. Open ASCENTRA in this browser to add it, or replace one of your devices.";

type Opts = {
  target?: (req: Request, params: Record<string, string | string[]>) => Target;
  /** "trusted" (default): the request must come from one of the account's trusted devices. */
  device?: "trusted" | "any";
  /** Security and appeal routes stay open to a suspended account. */
  allowSuspended?: boolean;
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
 *   a device that isn't trusted, or a suspended account → 403 (unless the route allows it);
 *   a sensitive action without a recent second factor → Clerk reverification;
 *   then the handler. For actions that need a reason, exactly one audit event is written per
 *   request: the handler's, or, if it didn't record one, one derived from its response.
 * Every event carries the request's trusted device id (null when the device isn't trusted).
 */
export function withCap(action: Action, handler: Handler, opts: Opts = {}) {
  return async (req: Request, ctx: RouteCtx): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? req.headers.get("x-vercel-id") ?? randomUUID();
    const authCtx = await getAuthContext();
    if (!authCtx) return unauthorized();
    const { account } = authCtx;
    const params = ctx?.params ? await ctx.params : {};
    const target = opts.target?.(req, params);
    const device = await resolveDevice(req, account.id);
    const deviceId = device.device?.id ?? null;

    // Capability first: someone without it is refused before anything else about the request matters.
    const decision = decide({ role: account.roleKey, assignedCourses: account.assignedCourses }, action, target);
    if (!decision.allowed) return (await requireCap(authCtx, action, target, { requestId, deviceId }))!;

    const raw = await readBody(req);
    const needsReason = requiresReason(action);
    let recorded = 0;
    const audit: Extras["audit"] = async (e) => {
      if (recorded++) throw new Error(`audit already recorded for this request (${action})`);
      await recordAudit({ ...e, actor: actorOf(account), requestId, reason: e.reason ?? reason, deviceId: e.deviceId !== undefined ? e.deviceId : deviceId });
    };
    const refuseRecorded = async (res: Response, why: string) => {
      if (needsReason) await recordQuietly({ actor: actorOf(account), action, context: `Refused: ${why}`, result: "Blocked", requestId, deviceId });
      return res;
    };

    if (raw === "invalid") return refuseRecorded(badRequest("The request body isn't valid JSON."), "the request body isn't valid JSON.");
    const { reason: rawReason, ...body } = raw;
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (needsReason && (reason.length < REASON_MIN || reason.length > REASON_MAX)) {
      const why = reason.length > REASON_MAX
        ? `The reason is too long (${REASON_MAX} characters at most).`
        : "Give a reason. It's recorded in the audit log.";
      await recordQuietly({ actor: actorOf(account), action, context: `Refused: ${why}`, result: "Blocked", requestId, deviceId });
      return badRequest(why);
    }

    const enforcement = await currentEnforcement(account.id, account.roleKey).catch((err) => {
      // Never let a read failure here lock anyone out of the Owner's account.
      if (account.roleKey === "owner") return NO_ENFORCEMENT;
      throw err;
    });
    if (enforcement.suspended && !opts.allowSuspended) {
      const why = `This account is suspended. ${enforcement.text}`;
      return refuseRecorded(Response.json({ error: "account_suspended", reason: why }, { status: 403, headers: NO_STORE }), why);
    }
    if (opts.device !== "any" && !device.device) {
      return refuseRecorded(Response.json({ error: "device_not_trusted", reason: DEVICE_NOT_TRUSTED }, { status: 403, headers: NO_STORE }), DEVICE_NOT_TRUSTED);
    }

    const verify = await requireCap(authCtx, action, target, { requestId, deviceId });
    if (verify) return verify;

    const res = await handler(req, ctx, account, {
      body, reason: needsReason ? reason : reason || null, requestId, sessionId: authCtx.sessionId, device, enforcement, audit,
    });
    if (needsReason && !recorded) {
      const ok = res.status < 400;
      let why = "";
      if (!ok) why = ((await res.clone().json().catch(() => ({}))) as { reason?: string }).reason ?? `HTTP ${res.status}`;
      await recordQuietly({
        actor: actorOf(account), action, requestId, reason, deviceId,
        context: ok ? `Completed (HTTP ${res.status}).` : `Refused: ${why}`,
        result: ok ? "Completed" : "Blocked",
      });
    }
    res.headers.set("x-request-id", requestId);
    return res;
  };
}
