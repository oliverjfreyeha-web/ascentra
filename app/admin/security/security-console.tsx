"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, when } from "../../call";

type Appeal = { id: string; reference: string; step: string; text: string; status: string; submittedAt: string; decisionReason: string | null; account?: { id: string; email: string; displayName: string; role: string } | null };
type SessionV = { id: string; device: string; state: string; startedAt: string; lastHeartbeatAt: string; endedAt: string | null; endReason: string | null; region: string | null };
type View = {
  account: { id: string; email: string; displayName: string; roleLabel: string; roleKey: string };
  deviceLimit: number;
  devices: { id: string; name: string; kind: string; region: string | null; state: string; trustedAt: string | null; lastSeenAt: string | null; revokedAt: string | null }[];
  sessions: SessionV[];
  overlaps: { a: SessionV; b: SessionV }[];
  signals: { kind: string; points: number; detail: string; at: string }[];
  score: { total: number; kinds: string[] };
  flags: { id: string; score: number; threshold: number; kinds: string[]; stepApplied: string | null; raisedAt: string }[];
  enforcement: { step: string | null; label: string | null; text: string | null; reason: string | null; limitUntil: string | null };
  history: { step: string; automatic: boolean; reason: string; at: string; limitUntil: string | null }[];
  appeals: Appeal[];
};
type Pending = { kind: "free"; deviceId: string; name: string } | { kind: "limit" | "suspend" } | { kind: "appeal"; appealId: string; reference: string; decision: "accept" | "decline" };

export function SecurityConsole() {
  const [queue, setQueue] = useState<Appeal[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const sensitive = useReverification(call);

  const loadQueue = useCallback(async () => {
    const r = await call("GET", "/api/v1/security/appeals");
    if (r._status === 200) setQueue(r.appeals as Appeal[]);
    else setBlocked(r._status === 401 ? "Sign in to continue." : (r.reason ?? "This page isn't available."));
  }, []);
  const open = useCallback(async (accountId: string) => {
    const r = await call("GET", `/api/v1/security/accounts/${accountId}`);
    if (r._status === 200) setView(r as unknown as View);
    else setMessage(r.reason ?? "Couldn't load that account.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void loadQueue();
  }, [loadQueue]);

  async function find(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const r = await call("GET", `/api/v1/security/accounts?q=${encodeURIComponent(q)}`);
    if (r._status === 200) await open((r.account as { id: string }).id);
    else {
      setView(null);
      setMessage(r.reason ?? "Not found.");
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    const accountId = view?.account.id;
    const [method, url, body] =
      pending.kind === "free" ? ["DELETE", `/api/v1/security/accounts/${accountId}/devices/${pending.deviceId}`, { reason }]
        : pending.kind === "appeal" ? ["POST", `/api/v1/security/appeals/${pending.appealId}`, { decision: pending.decision, reason }]
          : ["POST", `/api/v1/security/accounts/${accountId}/${pending.kind}`, { reason }];
    try {
      const r = await sensitive(method, url, body);
      setMessage(r._status >= 400 ? (r.reason ?? "That didn't work.") : "Done. Recorded in the audit log.");
      if (r._status < 400) {
        setPending(null);
        setReason("");
      }
    } catch {
      setMessage("Cancelled. Nothing changed.");
    }
    await loadQueue();
    if (accountId) await open(accountId);
  }

  if (blocked) return <p role="alert">{blocked}</p>;

  const reasonForm = (label: string) => (
    <form onSubmit={confirm} aria-label="Confirm">
      <p>
        <label htmlFor="sec-reason">{label}. Reason (required) </label>
        <input id="sec-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required size={40} />{" "}
        <button type="submit" className="primary">Confirm</button>{" "}
        <button type="button" className="link" onClick={() => setPending(null)}>Cancel</button>
      </p>
    </form>
  );

  return (
    <>
      {message && <p role="status">{message}</p>}

      <section aria-labelledby="queue-h">
        <h2 id="queue-h">Appeals under review</h2>
        {!queue ? <p className="muted">Loading…</p> : queue.length === 0 ? <p className="muted">No open appeals.</p> : (
          <table className="plain">
            <thead><tr><th>Reference</th><th>Account</th><th>Step</th><th>Submitted</th><th>Appeal</th><th /></tr></thead>
            <tbody>
              {queue.map((a) => (
                <tr key={a.id}>
                  <td>{a.reference}</td>
                  <td>{a.account ? `${a.account.displayName} · ${a.account.email}` : "—"}</td>
                  <td>{a.step}</td>
                  <td>{when(a.submittedAt)}</td>
                  <td>“{a.text}”</td>
                  <td>
                    {pending?.kind === "appeal" && pending.appealId === a.id ? reasonForm(`${pending.decision === "accept" ? "Accept" : "Decline"} ${a.reference}`) : (
                      <>
                        {a.account && <button type="button" className="link" onClick={() => open(a.account!.id)}>Review account</button>}{" · "}
                        <button type="button" className="link" onClick={() => setPending({ kind: "appeal", appealId: a.id, reference: a.reference, decision: "accept" })}>Accept</button>{" · "}
                        <button type="button" className="link" onClick={() => setPending({ kind: "appeal", appealId: a.id, reference: a.reference, decision: "decline" })}>Decline</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="find-h">
        <h2 id="find-h">Look up an account</h2>
        <form onSubmit={find}>
          <label htmlFor="find-q">Email </label>
          <input id="find-q" type="email" value={q} onChange={(e) => setQ(e.target.value)} required size={32} />{" "}
          <button type="submit" className="primary">Open</button>
        </form>
      </section>

      {view && (
        <section aria-labelledby="acct-h">
          <h2 id="acct-h">{view.account.displayName} · {view.account.email} <span className="muted">({view.account.roleLabel})</span></h2>
          <p>
            <b>Safeguard step:</b> {view.enforcement.label ?? "None"}
            {view.enforcement.limitUntil ? ` until ${when(view.enforcement.limitUntil)}` : ""}.{" "}
            <b>Sharing score now:</b> {view.score.total}{view.score.kinds.length ? ` (${view.score.kinds.join(", ")})` : ""}
          </p>
          {pending?.kind === "limit" || pending?.kind === "suspend" ? reasonForm(pending.kind === "limit" ? "Apply Limit" : "Apply Suspend") : (
            <p>
              <button type="button" className="link" onClick={() => setPending({ kind: "limit" })}>Apply Limit</button>{" · "}
              <button type="button" className="link" onClick={() => setPending({ kind: "suspend" })}>Apply Suspend</button>{" "}
              <span className="muted">Limit follows Verify and needs Support; Suspend follows Limit and needs a Super Admin or the Owner. Never the Owner.</span>
            </p>
          )}

          <h3>Devices <span className="muted">{view.devices.filter((d) => d.state === "trusted").length} of {view.deviceLimit} trusted</span></h3>
          <table className="plain">
            <thead><tr><th>Device</th><th>State</th><th>Trusted</th><th>Last active</th><th /></tr></thead>
            <tbody>
              {view.devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}{d.region ? <span className="muted"> · {d.region}</span> : null}</td>
                  <td>{d.state === "trusted" ? "Trusted" : `Removed ${when(d.revokedAt)}`}</td>
                  <td>{when(d.trustedAt)}</td>
                  <td>{when(d.lastSeenAt)}</td>
                  <td>
                    {d.state === "trusted" && (pending?.kind === "free" && pending.deviceId === d.id ? reasonForm(`Free the slot held by ${d.name}`) : (
                      <button type="button" className="link" onClick={() => setPending({ kind: "free", deviceId: d.id, name: d.name })}>Free this slot</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Recent sessions</h3>
          <table className="plain">
            <thead><tr><th>Device</th><th>Started</th><th>Last heartbeat</th><th>Ended</th><th>State</th></tr></thead>
            <tbody>
              {view.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.device}{s.region ? <span className="muted"> · {s.region}</span> : null}</td>
                  <td>{when(s.startedAt)}</td><td>{when(s.lastHeartbeatAt)}</td>
                  <td>{s.endedAt ? `${when(s.endedAt)} (${(s.endReason ?? "").replace(/_/g, " ")})` : "—"}</td>
                  <td>{s.state}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Overlaps</h3>
          {view.overlaps.length === 0 ? <p className="muted">None.</p> : (
            <ul>{view.overlaps.map((o) => <li key={`${o.a.id}-${o.b.id}`}>{o.a.device} ({when(o.a.startedAt)}) and {o.b.device} ({when(o.b.startedAt)})</li>)}</ul>
          )}

          <h3>Signals</h3>
          {view.signals.length === 0 ? <p className="muted">None.</p> : (
            <ul>{view.signals.map((s, i) => <li key={i}>{when(s.at)} · {s.kind} (+{s.points}): {s.detail}</li>)}</ul>
          )}

          <h3>Flag history</h3>
          {view.flags.length === 0 ? <p className="muted">No flags.</p> : (
            <ul>{view.flags.map((f) => <li key={f.id}>{when(f.raisedAt)} · score {f.score} of {f.threshold} · {f.kinds.join(", ")}{f.stepApplied ? ` → ${f.stepApplied}` : " → waiting for a person"}</li>)}</ul>
          )}

          <h3>Steps</h3>
          {view.history.length === 0 ? <p className="muted">None.</p> : (
            <ul>{view.history.map((h, i) => <li key={i}>{when(h.at)} · <b>{h.step}</b> ({h.automatic ? "automatic" : "by a person"}): {h.reason}</li>)}</ul>
          )}

          <h3>Appeals</h3>
          {view.appeals.length === 0 ? <p className="muted">None.</p> : (
            <ul>{view.appeals.map((a) => <li key={a.id}>{a.reference} · {a.step} · {a.status.replace("_", " ")} · “{a.text}”{a.decisionReason ? ` · ${a.decisionReason}` : ""}</li>)}</ul>
          )}
        </section>
      )}
    </>
  );
}
