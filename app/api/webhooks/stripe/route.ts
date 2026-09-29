import { readBillingEnv, stripeClient } from "@/lib/billing-env";
import { alreadyProcessed, handleStripeEvent } from "@/lib/billing-webhook";

// Stripe → Postgres. Nothing in the body is trusted until the signature checks out, and each event is
// applied once (billing_events). A failure answers 500 so Stripe retries.
export async function POST(req: Request) {
  const cfg = readBillingEnv();
  if (!cfg.ok) {
    console.error("[billing] webhook: not configured:", cfg.problems.join("; "));
    return Response.json({ error: "not_configured" }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "invalid_signature" }, { status: 400 });
  const stripe = stripeClient(cfg.env);
  let event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, cfg.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }
  if (await alreadyProcessed(event.id)) return Response.json({ ok: true, outcome: "duplicate" });
  try {
    const r = await handleStripeEvent(event, stripe, cfg.env);
    return Response.json({ ok: true, outcome: r.outcome });
  } catch (err) {
    console.error(`[billing] webhook ${event.type} ${event.id} failed:`, err instanceof Error ? err.message : err);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
