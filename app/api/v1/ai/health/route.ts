import { withCap } from "@/lib/auth";
import { checkAnthropic } from "@/lib/ai";
import { ok } from "@/lib/http";

/** Runs the model provider's health check now (GET /v1/models/{id}: no tokens) and records Connected or Disconnected. */
export const POST = withCap("ai.status", async (_req, _ctx, account, x) => {
  const r = await checkAnthropic({ accountId: account.id, requestId: x.requestId });
  await x.audit({
    action: "ai.status", result: r.status === "connected" ? "Completed" : "Blocked", status: r.status === "connected" ? "Recorded" : "Disconnected",
    context: `AI provider health check: ${r.status === "connected" ? "Connected" : "Disconnected"}. ${r.detail}`, target: { type: "service", id: "anthropic", label: "Anthropic" },
    next: r.status,
  });
  return ok(r);
});
