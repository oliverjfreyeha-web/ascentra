"use client";

import { useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, when } from "../call";

type Charge = { id: string; amountCents: number; refundedCents: number; status: string; paid: boolean; created: string; description: string | null };
type Lookup = { account: { id: string; email: string; displayName: string; roleLabel: string }; charges: Charge[]; balanceCents: number };
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const toCents = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s) * 100) : NaN);

/** Owner only (B4): refunds and credits, each with a reason; Stripe does the money, the audit log records why. */
export function AdjustmentsPanel() {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chargeId, setChargeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"refund" | "credit">("refund");
  const [busy, setBusy] = useState(false);
  const verified = useReverification(call);

  async function lookup(e?: FormEvent) {
    e?.preventDefault();
    setMessage(null);
    const r = await call("GET", `/api/v1/billing/adjustments?q=${encodeURIComponent(q)}`);
    if (r._status === 200) setFound(r as unknown as Lookup);
    else { setFound(null); setMessage(r.reason ?? "Not found."); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!found) return;
    const cents = amount.trim() ? toCents(amount) : undefined;
    if (cents !== undefined && Number.isNaN(cents)) return setMessage("Enter an amount like 20 or 12.50.");
    setBusy(true);
    const r = kind === "refund"
      ? await verified("POST", `/api/v1/billing/adjustments/${found.account.id}/refund`, { chargeId, amountCents: cents, reason })
      : await verified("POST", `/api/v1/billing/adjustments/${found.account.id}/credit`, { amountCents: cents, reason });
    setBusy(false);
    setMessage(r._status === 200 ? `${kind === "refund" ? "Refunded" : "Credited"} ${usd(r.amountCents as number)}. Recorded in the audit log.` : r.reason ?? "Nothing was changed.");
    if (r._status === 200) { setReason(""); setAmount(""); await lookup(); }
  }

  return (
    <section aria-labelledby="adj-h">
      <h2 id="adj-h">Refunds and credits</h2>
      <p className="muted">Owner only. Each needs a reason and your second factor, and is recorded in the audit log.</p>
      <form onSubmit={lookup}>
        <label>Account email or id <input value={q} onChange={(e) => setQ(e.target.value)} /></label>{" "}
        <button type="submit">Look up</button>
      </form>
      {message && <p role="status">{message}</p>}
      {found && (
        <form onSubmit={submit}>
          <p>{found.account.displayName} ({found.account.roleLabel}) · {found.account.email} · credit balance {usd(Math.max(0, -found.balanceCents))}</p>
          <fieldset>
            <legend>What</legend>
            <label><input type="radio" checked={kind === "refund"} onChange={() => setKind("refund")} /> Refund a charge</label>{" "}
            <label><input type="radio" checked={kind === "credit"} onChange={() => setKind("credit")} /> Credit to future invoices</label>
          </fieldset>
          {kind === "refund" && (
            found.charges.length === 0 ? <p className="muted">No charges.</p> : (
              <ul>
                {found.charges.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input type="radio" name="charge" checked={chargeId === c.id} onChange={() => setChargeId(c.id)} disabled={c.refundedCents >= c.amountCents} />{" "}
                      {usd(c.amountCents)} on {when(c.created)} · {c.status}{c.refundedCents ? ` · ${usd(c.refundedCents)} refunded` : ""}
                    </label>
                  </li>
                ))}
              </ul>
            )
          )}
          <p><label>Amount in USD {kind === "refund" ? "(empty: all that's left)" : ""} <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label></p>
          <p><label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} /></label></p>
          <button type="submit" disabled={busy}>{kind === "refund" ? "Refund" : "Credit"}</button>
        </form>
      )}
    </section>
  );
}
