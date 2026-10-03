import "server-only";
import type Stripe from "stripe";
import type { Account } from "@/lib/auth";
import type { AuditInput } from "@/lib/audit";
import { customerOf } from "@/lib/billing";
import { usd } from "@/lib/billing-terms";
import { findTargetAccount, loadTargetAccount } from "@/lib/security-view";

/**
 * B4: refunds and credits. The Owner only (OWNER_ONLY_CAPS), each with a reason, re-checked second factor, and an
 * audit event. Stripe holds the money record; the audit log holds who, why and how much.
 */
type Event = Omit<AuditInput, "actor" | "requestId" | "reason" | "deviceId">;
export type AdjustResult<T = Record<string, unknown>> =
  | { ok: true; body: T; event: Event }
  | { ok: false; status: number; reason: string; event: Event };
const refused = (status: number, reason: string, action: string, target: Event["target"] = null): AdjustResult<never> =>
  ({ ok: false, status, reason, event: { action, result: "Blocked", context: `Refused: ${reason}`, target } });

/** A credit is applied to future invoices. PLACEHOLDER ceiling for one credit: a year of Pro. */
export const MAX_CREDIT_CENTS = 60_000;

export async function lookupForAdjustments(q: string, stripe: Stripe) {
  const target = await findTargetAccount(q);
  if (!target) return null;
  const customer = await customerOf(target.id);
  if (!customer) return { account: target, charges: [], balanceCents: 0 };
  const [charges, c] = await Promise.all([stripe.charges.list({ customer, limit: 10 }), stripe.customers.retrieve(customer)]);
  return {
    account: target,
    charges: charges.data.map((ch) => ({
      id: ch.id, amountCents: ch.amount, refundedCents: ch.amount_refunded, status: ch.status, paid: ch.paid,
      created: new Date(ch.created * 1000).toISOString(), description: ch.description,
    })),
    // Stripe's balance is negative when the customer has credit.
    balanceCents: "deleted" in c && c.deleted ? 0 : (c as Stripe.Customer).balance,
  };
}

const cents = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

export async function refund(owner: Account, accountId: string, body: Record<string, unknown>, reason: string, stripe: Stripe, requestId: string): Promise<AdjustResult> {
  const A = "billing.refund";
  const target = await loadTargetAccount(accountId);
  if (!target) return refused(404, "No such account.", A, { type: "account", id: accountId });
  const who = { type: "account", id: target.id, label: target.email };
  const customer = await customerOf(target.id);
  const chargeId = typeof body.chargeId === "string" ? body.chargeId : "";
  if (!customer || !/^(ch|py)_[A-Za-z0-9]+$/.test(chargeId)) return refused(400, "Choose one of this account's charges.", A, who);
  const charge = await stripe.charges.retrieve(chargeId).catch(() => null);
  const chargeCustomer = charge && (typeof charge.customer === "string" ? charge.customer : charge.customer?.id);
  if (!charge || chargeCustomer !== customer) return refused(404, "That charge isn't this account's.", A, who);
  const left = charge.amount - charge.amount_refunded;
  const amount = body.amountCents == null ? left : cents(body.amountCents);
  if (!amount || amount > left || left <= 0) return refused(400, `Refund between $0.01 and ${usd(left)} (what's left on this charge).`, A, who);
  const r = await stripe.refunds.create(
    { charge: chargeId, amount, reason: "requested_by_customer", metadata: { ascentra_account_id: target.id, ascentra_by: owner.id, ascentra_reason: reason.slice(0, 450) } },
    { idempotencyKey: `ascentra-refund-${requestId}` },
  );
  return {
    ok: true, body: { refundId: r.id, amountCents: amount, status: r.status },
    event: {
      action: A, result: "Completed", sensitive: true, target: who,
      context: `Refunded ${usd(amount)} of charge ${chargeId} (${usd(charge.amount)}) to ${target.email}. Stripe refund ${r.id}: ${r.status}.`,
      previous: `${usd(charge.amount_refunded)} refunded`, next: `${usd(charge.amount_refunded + amount)} refunded`,
    },
  };
}

export async function credit(owner: Account, accountId: string, body: Record<string, unknown>, reason: string, stripe: Stripe, requestId: string): Promise<AdjustResult> {
  const A = "billing.credit";
  const target = await loadTargetAccount(accountId);
  if (!target) return refused(404, "No such account.", A, { type: "account", id: accountId });
  const who = { type: "account", id: target.id, label: target.email };
  const customer = await customerOf(target.id);
  if (!customer) return refused(404, "This account has no billing account yet, so there's nothing to credit.", A, who);
  const amount = cents(body.amountCents);
  if (!amount || amount > MAX_CREDIT_CENTS) return refused(400, `Credit between $0.01 and ${usd(MAX_CREDIT_CENTS)}.`, A, who);
  const t = await stripe.customers.createBalanceTransaction(
    customer,
    { amount: -amount, currency: "usd", description: "ASCENTRA credit (by the Owner)", metadata: { ascentra_by: owner.id, ascentra_reason: reason.slice(0, 450) } },
    { idempotencyKey: `ascentra-credit-${requestId}` },
  );
  return {
    ok: true, body: { creditId: t.id, amountCents: amount, balanceCents: t.ending_balance },
    event: {
      action: A, result: "Completed", sensitive: true, target: who,
      context: `Credited ${usd(amount)} to ${target.email}; it is taken off their next invoices. Stripe balance transaction ${t.id}.`,
      previous: usd(-t.ending_balance - amount), next: usd(-t.ending_balance),
    },
  };
}
