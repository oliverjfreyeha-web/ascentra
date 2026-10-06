"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useReverification } from "@clerk/nextjs";
import { call, when } from "../call";

type Consent = {
  id: string; title: string; version: string; status: "given" | "withdrawn"; at: string; method: string;
  for: string; by: string; current: boolean; withdraw: "here" | "guardian_center" | null;
};
type Request = { id: string; kind: string; status: string; due_at: string; completed_at: string | null; created_at: string; for: string };
type Privacy = {
  consents: Consent[]; requests: Request[]; subjects: { id: string; name: string }[];
  teenHandledByGuardian: boolean; canRequestDeletion: boolean; dueDays: { export: number; deletion: number };
  /** L4: how many Mentor conversations this account has (they're in the download and covered by a deletion request). */
  mentorThreads: number;
  /** L7: whether the learner has interview answers saved (in the download; covered by a deletion request). */
  interview: boolean;
};

/**
 * Account → Privacy Center (B4): what was agreed (document and version), withdrawing an optional consent,
 * downloading data as JSON, and requesting deletion. Every request is tracked with a due date.
 */
export function PrivacyCenter() {
  const [data, setData] = useState<Privacy | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [subject, setSubject] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const verified = useReverification(call);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/privacy");
    if (r._status === 200) setData(r as unknown as Privacy);
    else setMessage(r.reason ?? "Couldn't load the Privacy Center.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load
    void load();
  }, [load]);

  async function run(fn: () => Promise<Record<string, unknown> & { _status: number; reason?: string }>, ok: (r: Record<string, unknown>) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (r._status >= 400) setMessage(r.reason ?? "Something went wrong. Nothing was changed.");
      else ok(r);
    } catch {
      setMessage("That didn't go through. Nothing was changed.");
    }
    setBusy(false);
    await load();
  }

  function download() {
    void run(() => verified("POST", "/api/v1/privacy/export", subject ? { forAccountId: subject } : {}), (r) => {
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ascentra-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("Your data was downloaded. The request is recorded.");
    });
  }

  if (!data) return <section className="ui-block"><h2>Privacy Center</h2><p className="muted">{message ?? "Loading…"}</p></section>;
  return (
    <section aria-labelledby="privacy-h" className="ui-block">
      <h2 id="privacy-h">Privacy Center</h2>
      {message && <p role="status">{message}</p>}
      <h3>What you agreed to</h3>
      {data.consents.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <div className="table-wrap">
          <table className="plain">
            <thead><tr><th>Document</th><th>Version</th><th>For</th><th>Status</th><th>When</th><th></th></tr></thead>
            <tbody>
              {data.consents.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td><td>{c.version}</td><td>{c.for}{c.by !== "You" ? ` (by ${c.by})` : ""}</td>
                  <td>{c.status === "given" ? (c.current ? "Agreed" : "Agreed (later withdrawn)") : "Withdrawn"}</td>
                  <td>{when(c.at)}</td>
                  <td>
                    {c.withdraw === "here" && (
                      <button type="button" className="link" disabled={busy}
                        onClick={() => void run(() => call("POST", `/api/v1/privacy/consents/${c.id}/withdraw`), () => setMessage("Withdrawn. The plan ends at the end of the paid period, with no further charges."))}>
                        Withdraw
                      </button>
                    )}
                    {c.withdraw === "guardian_center" && <a href="/guardian">Withdraw in the Guardian Center</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Recurring billing can be withdrawn here (the plan ends at the period end). The Terms and Privacy Policy can&apos;t be withdrawn on their own: request deletion instead.</p>

      <h3>Your data</h3>
      {data.teenHandledByGuardian ? <p>Your Guardian handles export and deletion for your account.</p> : (
        <>
          {data.subjects.length > 1 && (
            <p>
              <label>For{" "}
                <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {data.subjects.map((s) => <option key={s.id} value={s.id === data.subjects[0].id ? "" : s.id}>{s.name}</option>)}
                </select>
              </label>
            </p>
          )}
          <p className="ui-actions">
            <button type="button" disabled={busy} onClick={download}>Download data (JSON)</button>{" "}
            {data.canRequestDeletion && !confirmDelete && <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Request deletion</button>}
          </p>
          {confirmDelete && (
            <p className="ui-legal">
              Request deletion of {subject ? data.subjects.find((s) => s.id === subject)?.name : "your account"}? It&apos;s handled within{" "}
              {data.dueDays.deletion} days. Nothing is deleted before then, and you can still use your account meanwhile.{" "}
              <button type="button" disabled={busy}
                onClick={() => void run(() => verified("POST", "/api/v1/privacy/deletion", subject ? { forAccountId: subject } : {}),
                  (r) => { setConfirmDelete(false); setMessage(`Deletion requested. Due by ${when(r.dueAt as string)}.`); })}>
                Confirm deletion request
              </button>{" "}
              <button type="button" className="link" onClick={() => setConfirmDelete(false)}>Keep my account</button>
            </p>
          )}
        </>
      )}
      <h3>Mentor conversations</h3>
      <p className="small muted">
        Private to you: Support never sees them, and they aren&apos;t used to train AI models. They&apos;re included in your data download and in a
        deletion request.
      </p>
      <p>
        {data.mentorThreads} conversation(s).{" "}
        {data.mentorThreads > 0 && (
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm("Delete all your Mentor conversations now? This can't be undone.")) {
              void run(() => call("DELETE", "/api/v1/mentor/threads"), (r) => setMessage(`Deleted ${r.deleted as number} Mentor conversation(s).`));
            }
          }}>Delete all my Mentor conversations</button>
        )}
      </p>
      <h3>Interview answers and your path</h3>
      <p className="small muted">
        Private to you and not used to train AI models. Included in your data download and in a deletion request.{" "}
        {data.interview ? <>You have answers saved: <Link href="/learn/path">view, redo or delete them</Link>.</> : "You haven't answered the interview."}
      </p>
      <h3>Your requests</h3>
      {data.requests.length === 0 ? <p className="muted">None.</p> : (
        <ul>
          {data.requests.map((r) => (
            <li key={r.id}>
              {r.kind === "export" ? "Data download" : "Deletion"} for {r.for}: {r.status}
              {r.status === "completed" ? ` on ${when(r.completed_at)}` : `, due by ${when(r.due_at)}`} (requested {when(r.created_at)})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
