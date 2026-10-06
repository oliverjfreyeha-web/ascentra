"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, when, type ApiResult } from "../call";
import { mentorAddonFrom, teenAllowancesFrom, type AddonCents, type MentorAddonInfo, type TeenAllowance } from "../billing-api";
import { AddonChanger, AllowanceMeter, CheckoutAddon } from "../account/mentor-addon";

type Doc = { key: "teen_terms" | "minor_privacy_notice"; title: string; version: string; body: string };
type Teen = {
  id: string; name: string; status: string; link: "invited" | "pending" | "verified" | "failed" | "withdrawn";
  authorizedAt: string | null; withdrawnAt: string | null;
  consents: { teen_terms: boolean; minor_privacy_notice: boolean; renewal: boolean };
  defaults: { voiceRecordings: string; uploads: string };
  subscription: null | { plan: string; status: string; renewsAt: string | null; paidThrough: string | null };
};
type Overview = { identity: { status: string; verifiedAt: string | null }; teens: Teen[]; documents: Doc[] };
type Billing = { plans: { key: "basic" | "pro"; name: string; cents: number }[]; terms: { title: string; version: string; body: string }; trialEligible: boolean; trialDays: number };

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const IDENTITY: Record<string, string> = {
  none: "Not started", started: "Started: finish it on Stripe's page", processing: "Stripe is checking your document",
  requires_input: "Stripe couldn't verify it. Try again.", verified: "Verified: you're an adult", failed: "Not verified as an adult. Contact Support.",
  canceled: "Canceled. Try again.",
};
const DEFAULTS = [
  "No sale or sharing of personal information", "No behavioral advertising", "Not publicly discoverable", "No precise location",
  "No biometric identification", "Uploads private by default", "Voice recordings off by default", "Age-appropriate explanations",
  "Clear reporting and safety controls",
];

/**
 * B3: for each linked teen, the Guardian (1) verifies their identity and adult status with Stripe Identity, (2) reviews
 * the teen account and agrees to each teen document, (3) pays as customer of record. They can withdraw consent at any
 * time. The server decides every step; this page shows what /api/v1/guardian returns.
 */
export function GuardianCenter() {
  const [data, setData] = useState<Overview | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [addonInfo, setAddonInfo] = useState<MentorAddonInfo | null>(null);
  const [allowances, setAllowances] = useState<Record<string, TeenAllowance | null>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verified = useReverification(call);

  const load = useCallback(async () => {
    const [o, b] = await Promise.all([call("GET", "/api/v1/guardian"), call("GET", "/api/v1/billing")]);
    if (o._status === 200) {
      setData(o as unknown as Overview);
      setAllowances(teenAllowancesFrom(o) ?? {});
    } else setMessage(o.reason ?? "Couldn't load the Guardian Center.");
    if (b._status === 200) {
      setBilling(b as unknown as Billing);
      setAddonInfo(mentorAddonFrom(b));
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the result of a Stripe redirect, read once
    if (q.get("identity") === "done") setMessage("Thanks. Stripe is checking your document; this page updates in a few seconds.");
    else if (q.get("billing") === "success") setMessage("Thanks. The account starts as soon as Stripe confirms the payment (usually a few seconds).");
    else if (q.get("billing") === "canceled") setMessage("Checkout was canceled. Nothing was charged.");
    void load();
    if (q.get("identity") === "done" || q.get("billing") === "success") {
      const t = [3000, 8000, 15000].map((ms) => setTimeout(() => void load(), ms));
      return () => t.forEach(clearTimeout);
    }
  }, [load]);

  async function act(run: () => Promise<ApiResult>, done?: (r: ApiResult) => void) {
    setBusy(true);
    setMessage(null);
    const r = await run();
    setBusy(false);
    if (r._status >= 400) setMessage(r.reason ?? "Something went wrong. Nothing was changed.");
    else done?.(r);
    await load();
  }

  if (!data) return <p className="muted">{message ?? "Loading…"}</p>;
  const idOk = data.identity.status === "verified";
  return (
    <>
      {message && <p role="status">{message}</p>}
      <section>
        <h2>1. Confirm you&apos;re an adult</h2>
        <p>
          Stripe Identity checks a photo ID and a selfie. ASCENTRA keeps only the result and the date, never the images.
        </p>
        <p>
          <b>{IDENTITY[data.identity.status] ?? data.identity.status}</b>
          {data.identity.verifiedAt && ` (${when(data.identity.verifiedAt)})`}
        </p>
        {!idOk && data.identity.status !== "failed" && (
          <button type="button" className="primary" disabled={busy}
            onClick={() => void act(() => call("POST", "/api/v1/guardian/identity"), (r) => window.location.assign(r.url as string))}>
            Verify my identity with Stripe
          </button>
        )}
      </section>
      {data.teens.length === 0 && <p>No teen is linked to your account yet.</p>}
      {data.teens.map((t) => (
        <TeenCard key={t.id} teen={t} data={data} billing={billing} idOk={idOk} busy={busy} act={act} verified={verified}
          addonInfo={addonInfo} allowance={allowances[t.id] ?? null} onAddonDone={(m) => { setMessage(m); void load(); }} />
      ))}
      <section>
        <h2>Billing</h2>
        <p>You&apos;re the customer of record for your teens&apos; plans.</p>
        <button type="button" disabled={busy} onClick={() => void act(() => verified("POST", "/api/v1/billing/portal"), (r) => window.location.assign(r.url as string))}>
          Manage billing
        </button>
      </section>
    </>
  );
}

function TeenCard({ teen: t, data, billing, idOk, busy, act, verified, addonInfo, allowance, onAddonDone }: {
  teen: Teen; data: Overview; billing: Billing | null; idOk: boolean; busy: boolean;
  addonInfo: MentorAddonInfo | null; allowance: TeenAllowance | null; onAddonDone: (message: string) => void;
  act: (run: () => Promise<ApiResult>, done?: (r: ApiResult) => void) => Promise<void>;
  verified: (method: string, url: string, body?: unknown) => Promise<ApiResult>;
}) {
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState<"basic" | "pro" | "">("");
  const [renewal, setRenewal] = useState(false);
  const [us, setUs] = useState(false);
  const [reason, setReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [addon, setAddon] = useState<AddonCents>(0);
  const [addonAgreed, setAddonAgreed] = useState(false);
  const consented = t.consents.teen_terms && t.consents.minor_privacy_notice;

  function agree(e: FormEvent) {
    e.preventDefault();
    const body = { agreed: Object.fromEntries(data.documents.filter((d) => agreed[d.key]).map((d) => [d.key, d.version])) };
    void act(() => verified("POST", `/api/v1/guardian/teens/${t.id}/consent`, body));
  }
  function checkout(e: FormEvent) {
    e.preventDefault();
    void act(() => call("POST", "/api/v1/billing/checkout", {
      plan, agreed: renewal, termsVersion: billing?.terms.version, usResident: us, teenAccountId: t.id,
      mentorAddonCents: addon, addonAgreed, addonTermsVersion: addonInfo?.terms.version,
    }),
      (r) => window.location.assign(r.url as string));
  }
  function withdraw(e: FormEvent) {
    e.preventDefault();
    void act(() => verified("POST", `/api/v1/guardian/teens/${t.id}/withdraw`, { reason }), () => setWithdrawing(false));
  }

  return (
    <section>
      <h2>{t.name}</h2>
      {t.link === "withdrawn" && <p>You withdrew consent on {when(t.withdrawnAt)}. {t.name}&apos;s account is paused, not deleted.</p>}
      {t.link === "verified" && t.status === "active" && (
        <p>
          Active since {when(t.authorizedAt)}. Plan: {t.subscription ? `${t.subscription.plan} (${t.subscription.status})` : "none"}.
          Voice recordings: {t.defaults.voiceRecordings}. Uploads: {t.defaults.uploads}.
          {t.subscription && t.subscription.status !== "canceled" && (
            <>
              {" "}
              <button type="button" className="link" disabled={busy}
                onClick={() => void act(() => call("POST", "/api/v1/billing/cancel", { teenAccountId: t.id }), (r) => window.location.assign(r.url as string))}>
                Cancel {t.name}&apos;s plan
              </button>
            </>
          )}
        </p>
      )}
      {allowance && allowance.status !== "exempt" && (
        <div>
          <h3>{t.name}&apos;s Mentor allowance</h3>
          <AllowanceMeter a={allowance} />
          {allowance.status === "used_up" && <p>The Mentor is paused for {t.name} until it resets, unless you raise it. Only you can change it.</p>}
          {addonInfo?.available && t.subscription?.status !== "canceled" && (
            <AddonChanger choices={allowance.choices} current={allowance} terms={addonInfo.terms} teenAccountId={t.id} onDone={onAddonDone} />
          )}
        </div>
      )}
      {t.link === "pending" && !idOk && <p>Confirm you&apos;re an adult first (above).</p>}
      {t.link === "pending" && idOk && !consented && (
        <form onSubmit={agree}>
          <h3>2. Review {t.name}&apos;s account</h3>
          <p>
            You&apos;ll see {t.name}&apos;s progress, milestones, completed work, schedule, billing, devices and safety alerts. Not
            {" "}{t.name}&apos;s notes or Mentor conversations. Every teen account has these protections:
          </p>
          <ul>{DEFAULTS.map((d) => <li key={d}>{d}</li>)}</ul>
          {data.documents.map((d) => (
            <div key={d.key}>
              <details><summary>{d.title} {d.version}</summary><p>{d.body}</p></details>
              <label>
                <input type="checkbox" checked={!!agreed[d.key]} onChange={(e) => setAgreed({ ...agreed, [d.key]: e.target.checked })} />{" "}
                I agree to the {d.title} ({d.version}) for {t.name}.
              </label>
            </div>
          ))}
          <p><button type="submit" className="primary" disabled={busy}>Agree</button></p>
        </form>
      )}
      {t.link === "pending" && idOk && consented && billing && (
        <form onSubmit={checkout}>
          <h3>3. Choose {t.name}&apos;s plan</h3>
          <fieldset>
            <legend>Plan</legend>
            {billing.plans.map((p) => (
              <label key={p.key}>
                <input type="radio" name={`plan-${t.id}`} checked={plan === p.key} onChange={() => { setPlan(p.key); setAddon(0); setAddonAgreed(false); }} /> {p.name}, {usd(p.cents)}/month
                {p.key === "basic" && billing.trialEligible && ` (${billing.trialDays}-day free trial first)`}{" "}
              </label>
            ))}
          </fieldset>
          {plan && addonInfo?.available && (
            <CheckoutAddon choices={addonInfo.choices[plan]} value={addon} onChange={(c) => { setAddon(c); setAddonAgreed(false); }} agreed={addonAgreed}
              onAgree={setAddonAgreed} terms={addonInfo.terms} name={`addon-${t.id}`} trial={plan === "basic" && billing.trialEligible} />
          )}
          <details><summary>{billing.terms.title} {billing.terms.version}</summary><p>{billing.terms.body}</p></details>
          <p>
            <label><input type="checkbox" checked={renewal} onChange={(e) => setRenewal(e.target.checked)} /> I agree to the {billing.terms.title} and to be charged
              {" "}for {t.name}&apos;s plan{addon > 0 ? ` and the ${usd(addon)} Mentor allowance` : ""} every month until I cancel. I&apos;m the customer of record.</label>
          </p>
          <p><label><input type="checkbox" checked={us} onChange={(e) => setUs(e.target.checked)} /> I live in the United States</label></p>
          <p><button type="submit" className="primary" disabled={busy || !plan || (addon > 0 && !addonAgreed)}>Continue to payment</button></p>
        </form>
      )}
      {(t.link === "pending" || t.link === "verified") && (
        withdrawing ? (
          <form onSubmit={withdraw}>
            <p>
              {t.name}&apos;s account pauses right away. Nothing is deleted; progress is kept. The plan ends at the end of the
              current period, with no further charges.
            </p>
            <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>{" "}
            <button type="submit" disabled={busy}>Withdraw consent</button>{" "}
            <button type="button" className="link" onClick={() => setWithdrawing(false)}>Keep consent</button>
          </form>
        ) : (
          <p><button type="button" className="link" onClick={() => setWithdrawing(true)}>Withdraw consent for {t.name}</button></p>
        )
      )}
    </section>
  );
}
