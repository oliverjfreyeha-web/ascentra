import { withCap } from "@/lib/auth";
import { submitAppeal } from "@/lib/enforcement";
import { ok, refuse } from "@/lib/http";
import { appealQueue } from "@/lib/security-view";

// The review queue: open appeals, oldest first (Owner, Super Admin, Support).
export const GET = withCap("security.inspect", async () => ok({ appeals: await appealQueue() }));

// Appeal the step on your own account. Open to a suspended account, from any device.
export const POST = withCap("security.appeal.submit", async (_req, _ctx, account, x) => {
  const text = typeof x.body.text === "string" ? x.body.text : "";
  const r = await submitAppeal(account, text);
  await x.audit({ ...r.event, reason: text.trim().slice(0, 500) || null });
  return r.ok ? ok({ appeal: { reference: r.appeal!.reference, status: r.appeal!.status } }, 201) : refuse(r.status, r.reason);
}, { device: "any", allowSuspended: true });
