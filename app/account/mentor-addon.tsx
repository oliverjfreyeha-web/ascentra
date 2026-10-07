"use client";

import { useState } from "react";
import { call } from "../call";
import { addonChangeFrom, addonName, addonQuoteFrom, usd, type AddonCents, type AddonQuote, type AllowanceView } from "../billing-api";
import { Meter } from "../ui/meter";

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "your next renewal");
type Terms = { title: string; version: string; body: string };

/** L5: the meter, "Mentor allowance: used X of Y, resets on DATE", as shown to the learner, a teen and their Guardian. */
export function AllowanceMeter({ a }: { a: AllowanceView }) {
  if (!a.line) return null;
  return (
    <p aria-label="Mentor allowance meter" className="ui-meter-line">
      <Meter max={a.usableUsd || 1} value={Math.min(a.usedUsd, a.usableUsd)} /> {a.line}
      {a.trial ? " (free trial allowance; the add-on is first charged when the trial converts)" : ""}
      {a.nextAddonCents !== a.addonCents ? `. From ${day(a.resetsAt)}: ${addonName(a.nextAddonCents)}.` : ""}
    </p>
  );
}

/**
 * L5: change the Mentor allowance on a live plan. Step 1 asks the server for a quote (what changes, when, and what is
 * charged today); step 2 shows it with the terms and a separate checkbox, and confirms with the quoted charge.
 */
export function AddonChanger({ choices, current, terms, teenAccountId, onDone }: {
  choices: readonly AddonCents[]; current: AllowanceView; terms: Terms; teenAccountId?: string; onDone: (message: string) => void;
}) {
  const [amount, setAmount] = useState<AddonCents>(current.nextAddonCents as AddonCents);
  const [quote, setQuote] = useState<AddonQuote | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const body = (extra: Record<string, unknown> = {}) => ({ amountCents: amount, agreed, termsVersion: terms.version, ...(teenAccountId ? { teenAccountId } : {}), ...extra });

  async function review() {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", "/api/v1/billing/mentor-addon", body({ agreed: false }));
    setBusy(false);
    const q = r._status === 200 ? addonQuoteFrom(r) : null;
    if (!q) return setMessage(r.reason ?? "The change couldn't be priced. Nothing changed.");
    setQuote(q);
    setAgreed(false);
  }

  async function confirm() {
    if (!quote) return;
    if (quote.amountCents > 0 && !agreed) return setMessage(`Agree to the ${terms.title} to continue.`);
    setBusy(true);
    const r = await call("POST", "/api/v1/billing/mentor-addon", body({ confirm: true, expectedChargeCents: quote.chargeTodayCents }));
    setBusy(false);
    const done = r._status === 200 ? addonChangeFrom(r) : null;
    if (!done) return setMessage(r.reason ?? "The change didn't go through. Nothing changed.");
    setQuote(null);
    onDone(done.effect === "renewal"
      ? `Done. The Mentor allowance changes to ${addonName(done.amountCents)} at the next renewal; this period keeps its allowance.`
      : `Done. The Mentor allowance is now ${addonName(done.amountCents)}${done.chargedTodayCents ? `; ${usd(done.chargedTodayCents)} was charged today` : ""}.`);
  }

  return (
    <div>
      {message && <p role="status">{message}</p>}
      {!quote && (
        <fieldset className="ui-group">
          <legend>Change the Mentor allowance</legend>
          {choices.map((c) => (
            <label key={c} className="ui-pill">
              <input type="radio" name={`addon-${teenAccountId ?? "me"}`} checked={amount === c} onChange={() => setAmount(c)} /> {addonName(c)}
              {c === current.nextAddonCents ? " (current)" : ""}
            </label>
          ))}{" "}
          <button type="button" disabled={busy || amount === current.nextAddonCents} onClick={() => void review()}>Review the change</button>
          <p className="small muted">Raising it takes effect right away (you pay the prorated difference today). Lowering or removing it takes effect at the next renewal.</p>
        </fieldset>
      )}
      {quote && (
        <div className="ui-legal">
          <p><b>{addonName(quote.previousCents)} → {addonName(quote.amountCents)}</b></p>
          <p>
            {quote.effect === "now" && `Usable right away. Charged today: ${usd(quote.chargeTodayCents)}${quote.chargeTodayCents ? " (the prorated difference for the rest of this period)" : ""}.`}
            {quote.effect === "renewal" && `Takes effect on ${day(quote.usableFrom)}. Nothing is charged or refunded today; this period keeps its allowance.`}
            {quote.effect === "conversion" && `Nothing is charged today. The add-on is first charged when the free trial ends on ${day(quote.nextChargeAt)}.`}
            {" "}Then {usd(quote.nextChargeCents)} every month (plan and Mentor allowance) from {day(quote.nextChargeAt)}, until you change or cancel.
          </p>
          {quote.amountCents > 0 && (
            <>
              <details><summary>{terms.title} {terms.version}</summary><p className="small">{terms.body}</p></details>
              <p>
                <label className="ui-consent">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> <b>Mentor allowance.</b>{" "}
                  I agree to the {terms.title}. {quote.disclosure}
                </label>
              </p>
            </>
          )}
          <button type="button" className="primary" disabled={busy || (quote.amountCents > 0 && !agreed)} onClick={() => void confirm()}>
            {quote.chargeTodayCents ? `Confirm and pay ${usd(quote.chargeTodayCents)} today` : "Confirm"}
          </button>{" "}
          <button type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
        </div>
      )}
    </div>
  );
}

/** L5: the add-on in a checkout form: none or an amount, with its own terms and checkbox (separate from the plan's). */
export function CheckoutAddon({ choices, value, onChange, agreed, onAgree, terms, name, trial }: {
  choices: readonly AddonCents[]; value: AddonCents; onChange: (c: AddonCents) => void; agreed: boolean; onAgree: (v: boolean) => void;
  terms: Terms; name: string; trial: boolean;
}) {
  return (
    <fieldset className="ui-group">
      <legend>Mentor allowance (optional, prepaid monthly add-on)</legend>
      {choices.map((c) => (
        <label key={c} className="ui-pill">
          <input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} /> {addonName(c)}
        </label>
      ))}
      <p className="small muted">The Mentor needs an allowance. It pays for the Mentor&apos;s AI use and resets every month; unused allowance doesn&apos;t carry over.</p>
      {value > 0 && (
        <>
          <details><summary>{terms.title} {terms.version}</summary><p className="small">{terms.body}</p></details>
          <p>
            <label className="ui-consent">
              <input type="checkbox" checked={agreed} onChange={(e) => onAgree(e.target.checked)} /> <b>Mentor allowance.</b>{" "}
              I agree to the {terms.title}: {usd(value)} per month, renewing automatically with the plan until I remove it
              {trial ? ", first charged when the free trial ends" : ""}.
            </label>
          </p>
        </>
      )}
    </fieldset>
  );
}
