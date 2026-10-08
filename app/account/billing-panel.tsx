"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call } from "../call";
import { mentorAddonFrom, usd as fmt, type AddonCents, type MentorAddonInfo } from "../billing-api";
import { AddonChanger, AllowanceMeter, CheckoutAddon } from "./mentor-addon";
import { Loading } from "../ui/loading";

type Plan = { key: "basic" | "pro"; name: string; cents: number };
type Billing = {
  configured: boolean;
  canSubscribe: boolean;
  canManage: boolean;
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
  const [addonInfo, setAddonInfo] = useState<MentorAddonInfo | null>(null);
  const [addon, setAddon] = useState<AddonCents>(0);
  const [addonAgreed, setAddonAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<"basic" | "pro" | "">("");
  const [agreed, setAgreed] = useState(false);
  const [us, setUs] = useState(false);
  const [busy, setBusy] = useState(false);
  const portal = useReverification(call);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/billing");
    if (r._status === 200) {
      setData(r as unknown as Billing);
      setAddonInfo(mentorAddonFrom(r));
    }
    else setMessage(r.reason ?? "Couldn't load your plan.");
  }, []);

  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("billing");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the result of the Stripe redirect, read once
    if (back === "success") setMessage("Thanks. Your plan appears here as soon as Stripe confirms it (usually a few seconds).");
    else if (back === "canceled") setMessage("Checkout was canceled. Nothing was charged.");
    else if (back === "canceled_plan") setMessage("Your plan is canceled. You keep access until the end of the paid period, and you won't be charged again.");
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
    if (addon > 0 && !addonAgreed) return setMessage("Agree to the Mentor Allowance Terms, or choose no Mentor allowance.");
    setBusy(true);
    const r = await call("POST", "/api/v1/billing/checkout", {
      plan, agreed, termsVersion: data.terms.version, usResident: us,
      mentorAddonCents: addon, addonAgreed, addonTermsVersion: addonInfo?.terms.version,
    });
    if (r._status === 200 && typeof r.url === "string") {
      window.location.assign(r.url);
      return;
    }
    setBusy(false);
    setMessage(r.reason ?? "Checkout couldn't start. Nothing was charged.");
  }

  async function cancelPlan() {
    setBusy(true);
    const r = await call("POST", "/api/v1/billing/cancel", {});
    if (r._status === 200 && typeof r.url === "string") return window.location.assign(r.url);
    setBusy(false);
    setMessage(r.reason ?? "The cancellation page couldn't open. Nothing was changed.");
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

  if (!data) return message ? <p className="muted ui-state ui-state--error">{message}</p> : <Loading label="Loading your plan…" />;
  const s = data.subscription;
  const chosen = data.plans.find((p) => p.key === plan);
  const trial = plan === "basic" && data.trialEligible;
  const trialEnd = data.trialWouldEndAt;
  const addonChoices = chosen && addonInfo?.available ? addonInfo.choices[chosen.key] : null;
  const monthly = (chosen?.cents ?? 0) + addon;
  const withAddon = addon > 0 ? ` (${fmt(chosen?.cents ?? 0)} plan + ${fmt(addon)} Mentor allowance)` : "";

  return (
    <section aria-labelledby="billing-h" className="ui-block">
      <h2 id="billing-h">Billing</h2>
      {message && <p role="status">{message}</p>}
      <dl className="ui-facts">
        <div><dt>Access</dt><dd>{TIER_LABEL[data.tier]}{data.source === "role" ? " (from your role)" : ""}</dd></div>
        {s && (
          <>
            <div><dt>Plan</dt><dd>{PLAN_LABEL[s.plan]}</dd></div>
            <div><dt>Status</dt><dd>{STATUS_LABEL[s.status]}</dd></div>
            {s.trialEndsAt && (<div><dt>Trial ends</dt><dd>{day(s.trialEndsAt)}</dd></div>)}
            {s.nextChargeAt && (<div><dt>Next charge</dt><dd>{s.nextChargeCents != null ? `${usd(s.nextChargeCents)} on ` : ""}{day(s.nextChargeAt)}</dd></div>)}
            {s.accessUntil && (<div><dt>Access until</dt><dd>{day(s.accessUntil)}. You won&apos;t be charged again.</dd></div>)}
          </>
        )}
      </dl>

      {s && data.canManage && (
        <p className="ui-actions">
          <button type="button" onClick={manage} disabled={busy}>Manage billing</button>{" "}
          {s.status !== "canceled" && (
            <>
              <button type="button" onClick={cancelPlan} disabled={busy}>Cancel plan</button>{" "}
            </>
          )}
          <span className="muted">
            Cancel in two steps: Cancel plan, then confirm on Stripe&apos;s page. You keep access until the paid period ends.
            Manage billing changes plans or the payment method.
          </span>
        </p>
      )}
      {s && !data.canManage && <p className="muted">Your Guardian manages this plan.</p>}

      {s && addonInfo && addonInfo.allowance.status !== "exempt" && (
        <div id="mentor-allowance">
          <h3>Mentor allowance</h3>
          <AllowanceMeter a={addonInfo.allowance} />
          {addonInfo.allowance.status === "used_up" && <p>The Mentor is paused until the allowance resets{addonInfo.canChange ? ", or until you raise it" : ""}.</p>}
          {addonInfo.canChange && addonInfo.available && (
            <AddonChanger choices={addonInfo.choices[s.plan === "pro" ? "pro" : "basic"]} current={addonInfo.allowance} terms={addonInfo.terms}
              onDone={(m) => { setMessage(m); void load(); }} />
          )}
          {!addonInfo.canChange && !data.canManage && <p className="muted">Only your Guardian can choose, change or remove your Mentor allowance.</p>}
          <p className="small muted">
            Usable allowance is the add-on minus {addonInfo.reservePercent}% for running costs. It resets each billing period; unused allowance doesn&apos;t carry over.
          </p>
        </div>
      )}

      {!s && data.canSubscribe && !data.configured && <p className="muted">Plans aren&apos;t available yet.</p>}
      {!s && data.canSubscribe && data.configured && (
        <form onSubmit={checkout} aria-label="Choose a plan" className="ui-form">
          <fieldset>
            <legend>Choose a plan</legend>
            <div className="ui-choices">
            {data.plans.map((p) => (
              <label key={p.key} className="ui-choice">
                <input type="radio" name="plan" value={p.key} checked={plan === p.key} onChange={() => { setPlan(p.key); setAddon(0); setAddonAgreed(false); }} />{" "}
                <span>
                  <b className="ui-choice__title">{p.name}</b> <span className="ui-choice__price"><span className="sr-only">· </span>{usd(p.cents)}</span>{" "}
                  <span className="ui-choice__note">per month
                  {p.key === "basic" && data.trialEligible ? ` · starts with a free ${data.trialDays}-day trial` : ""}</span>
                </span>
              </label>
            ))}
            </div>
          </fieldset>
          {addonChoices && addonInfo && (
            <CheckoutAddon choices={addonChoices} value={addon} onChange={(c) => { setAddon(c); setAddonAgreed(false); }} agreed={addonAgreed}
              onAgree={setAddonAgreed} terms={addonInfo.terms} name="addon" trial={trial} />
          )}
          <div className="ui-legal">
            <p><b>{data.terms.title}</b> <span className="muted">{data.terms.version}</span></p>
            <p className="small">{data.terms.body}</p>
          </div>
          {chosen && (
            <p>
              <label className="ui-consent">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{" "}
                <b>Recurring billing.</b>{" "}
                {trial
                  ? `I agree that after my free trial ends on ${day(trialEnd)}, I'll be charged ${usd(monthly)}${withAddon} every month until I cancel.`
                  : `I agree that I'll be charged ${usd(monthly)}${withAddon} today and every month after until I cancel.`}{" "}
                I can cancel any time from Manage billing.
              </label>
            </p>
          )}
          <p>
            <label className="ui-consent">
              <input type="checkbox" checked={us} onChange={(e) => setUs(e.target.checked)} /> I live in the United States.
            </label>
          </p>
          <p className="ui-actions">
          <button type="submit" className="primary" disabled={busy}>
            {trial ? `Start my ${data.trialDays}-day trial` : chosen ? `Continue to checkout · ${usd(monthly)} today` : "Continue to checkout"}
          </button>{" "}
          <span className="muted">You&apos;ll enter your card on Stripe&apos;s secure page. ASCENTRA never sees it.</span>
          </p>
        </form>
      )}
    </section>
  );
}
