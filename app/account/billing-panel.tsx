"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call } from "../call";

type Plan = { key: "basic" | "pro"; name: string; cents: number };
type Billing = {
  configured: boolean;
  canSubscribe: boolean;
  tier: "none" | "trial" | "basic" | "pro" | "full";
  source: string;
  subscription: null | {
    plan: "trial" | "basic" | "pro"; status: "trialing" | "active" | "past_due" | "canceled";
    trialEndsAt: string | null; nextChargeAt: string | null; nextChargeCents: number | null; accessUntil: string | null;
  };
  trialEligible: boolean;
  trialDays: number;
  trialWouldEndAt: string;
  plans: Plan[];
  terms: { title: string; version: string; body: string };
};

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—");
const PLAN_LABEL = { trial: "14-day free trial (converts to Basic)", basic: "Basic", pro: "Pro" } as const;
const STATUS_LABEL = { trialing: "Trial", active: "Active", past_due: "Payment failed: Stripe is retrying. Update your payment method.", canceled: "Canceled" } as const;
const TIER_LABEL = { none: "No plan", trial: "Trial (Basic features)", basic: "Basic", pro: "Pro", full: "Full access (Owner)" } as const;

/** Account → Billing: current plan, trial end, next charge, checkout for a new plan, and Stripe's portal. */
export function BillingPanel() {
  const [data, setData] = useState<Billing | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<"basic" | "pro" | "">("");
  const [agreed, setAgreed] = useState(false);
  const [us, setUs] = useState(false);
  const [busy, setBusy] = useState(false);
  const portal = useReverification(call);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/billing");
    if (r._status === 200) setData(r as unknown as Billing);
    else setMessage(r.reason ?? "Couldn't load your plan.");
  }, []);

  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("billing");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the result of the Stripe redirect, read once
    if (back === "success") setMessage("Thanks. Your plan appears here as soon as Stripe confirms it (usually a few seconds).");
    else if (back === "canceled") setMessage("Checkout was canceled. Nothing was charged.");
    void load();
    // Stripe confirms by webhook, a moment after the redirect: look again a few times.
    if (back === "success") {
      const t = [3000, 8000, 15000].map((ms) => setTimeout(() => void load(), ms));
      return () => t.forEach(clearTimeout);
    }
  }, [load]);

  async function checkout(e: FormEvent) {
    e.preventDefault();
    if (!data || !plan) return setMessage("Choose Basic or Pro.");
    if (!agreed) return setMessage("Agree to the recurring billing terms to continue.");
    if (!us) return setMessage("ASCENTRA is available in the United States only.");
    setBusy(true);
    const r = await call("POST", "/api/v1/billing/checkout", { plan, agreed, termsVersion: data.terms.version, usResident: us });
    if (r._status === 200 && typeof r.url === "string") {
      window.location.assign(r.url);
      return;
    }
    setBusy(false);
    setMessage(r.reason ?? "Checkout couldn't start. Nothing was charged.");
  }

  async function manage() {
    setBusy(true);
    try {
      const r = await portal("POST", "/api/v1/billing/portal", {});
      if (r._status === 200 && typeof r.url === "string") return window.location.assign(r.url);
      setMessage(r.reason ?? "The billing portal couldn't open.");
    } catch {
      setMessage("The billing portal wasn't opened.");
    }
    setBusy(false);
  }

  if (!data) return <p className="muted">{message ?? "Loading your plan…"}</p>;
  const s = data.subscription;
  const chosen = data.plans.find((p) => p.key === plan);
  const trial = plan === "basic" && data.trialEligible;
  const trialEnd = data.trialWouldEndAt;

  return (
    <section aria-labelledby="billing-h">
      <h2 id="billing-h">Billing</h2>
      {message && <p role="status">{message}</p>}
      <dl className="kv">
        <dt>Access</dt><dd>{TIER_LABEL[data.tier]}{data.source === "role" ? " (from your role)" : ""}</dd>
        {s && (
          <>
            <dt>Plan</dt><dd>{PLAN_LABEL[s.plan]}</dd>
            <dt>Status</dt><dd>{STATUS_LABEL[s.status]}</dd>
            {s.trialEndsAt && (<><dt>Trial ends</dt><dd>{day(s.trialEndsAt)}</dd></>)}
            {s.nextChargeAt && (<><dt>Next charge</dt><dd>{s.nextChargeCents != null ? `${usd(s.nextChargeCents)} on ` : ""}{day(s.nextChargeAt)}</dd></>)}
            {s.accessUntil && (<><dt>Access until</dt><dd>{day(s.accessUntil)}. You won&apos;t be charged again.</dd></>)}
          </>
        )}
      </dl>

      {s && (
        <p>
          <button type="button" onClick={manage} disabled={busy}>Manage billing</button>{" "}
          <span className="muted">Cancel, change between Basic and Pro, or update your payment method (Stripe).</span>
        </p>
      )}

      {!s && data.canSubscribe && !data.configured && <p className="muted">Plans aren&apos;t available yet.</p>}
      {!s && data.canSubscribe && data.configured && (
        <form onSubmit={checkout} aria-label="Choose a plan">
          <fieldset>
            <legend>Choose a plan</legend>
            {data.plans.map((p) => (
              <p key={p.key}>
                <label>
                  <input type="radio" name="plan" value={p.key} checked={plan === p.key} onChange={() => setPlan(p.key)} />{" "}
                  <b>{p.name}</b> · {usd(p.cents)} per month
                  {p.key === "basic" && data.trialEligible ? ` · starts with a free ${data.trialDays}-day trial` : ""}
                </label>
              </p>
            ))}
          </fieldset>
          <div className="notice">
            <p><b>{data.terms.title}</b> <span className="muted">{data.terms.version}</span></p>
            <p className="small">{data.terms.body}</p>
          </div>
          {chosen && (
            <p>
              <label>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{" "}
                <b>Recurring billing.</b>{" "}
                {trial
                  ? `I agree that after my free trial ends on ${day(trialEnd)}, I'll be charged ${usd(data.plans.find((p) => p.key === "basic")!.cents)} every month until I cancel.`
                  : `I agree that I'll be charged ${usd(chosen.cents)} today and every month after until I cancel.`}{" "}
                I can cancel any time from Manage billing.
              </label>
            </p>
          )}
          <p>
            <label>
              <input type="checkbox" checked={us} onChange={(e) => setUs(e.target.checked)} /> I live in the United States.
            </label>
          </p>
          <button type="submit" className="primary" disabled={busy}>
            {trial ? `Start my ${data.trialDays}-day trial` : chosen ? `Continue to checkout · ${usd(chosen.cents)} today` : "Continue to checkout"}
          </button>{" "}
          <span className="muted">You&apos;ll enter your card on Stripe&apos;s secure page. ASCENTRA never sees it.</span>
        </form>
      )}
    </section>
  );
}
