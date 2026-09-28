"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";

type Event = {
  seq: number; at: string; actor: string; action: string; context: string | null; target: string | null;
  previous: string | null; next: string | null; reason: string | null; result: "Completed" | "Blocked";
  status: string; sensitive: boolean;
};
type Report = { ok: boolean; checked: number; brokenAtSeq: number | null; problem: string | null; headSeq: number | null; headHash: string | null };
type Filters = { actor: string; action: string; target: string; from: string; to: string };

const EMPTY: Filters = { actor: "", action: "", target: "", from: "", to: "" };
const qs = (f: Filters, before?: number) => {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v.trim()) as [string, string][]);
  if (before) p.set("before", String(before));
  return p.toString();
};

/** Export returns CSV, or JSON (an error or Clerk's reverification hint, which useReverification handles). */
async function exportFetch(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/v1/audit/export", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
  if ((res.headers.get("content-type") ?? "").includes("text/csv")) return { _status: res.status, csv: await res.text() };
  return { ...((await res.json().catch(() => ({}))) as Record<string, unknown>), _status: res.status };
}

export function AuditLog() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [events, setEvents] = useState<Event[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const exportCsv = useReverification(exportFetch);

  const search = useCallback(async (f: Filters, before?: number) => {
    const res = await fetch(`/api/v1/audit?${qs(f, before)}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBlocked(res.status === 401 ? "Sign in to continue." : (json.reason ?? "The audit log isn't available."));
      return;
    }
    setEvents((prev) => (before && prev ? [...prev, ...json.events] : json.events));
    setNext(json.next);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void search(EMPTY);
    void fetch("/api/v1/me", { cache: "no-store" }).then(async (r) => r.ok && setIsOwner((await r.json()).account?.roleKey === "owner"));
  }, [search]);

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value });

  async function onExport(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const r = await exportCsv({ ...filters, reason });
      if (typeof r.csv === "string") {
        const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
        const a = Object.assign(document.createElement("a"), { href: url, download: `ascentra-audit-${new Date().toISOString().slice(0, 10)}.csv` });
        a.click();
        URL.revokeObjectURL(url);
        setMessage("Exported. The export is recorded in the audit log.");
        setReason("");
        await search(filters);
      } else setMessage((r.reason as string) ?? "The export failed.");
    } catch {
      setMessage("The export was cancelled.");
    }
  }

  async function onVerify() {
    setMessage(null);
    const res = await fetch("/api/v1/audit/verify", { method: "POST", cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setReport(json.report);
      await search(filters);
    } else setMessage(json.reason ?? "Verification failed.");
  }

  if (blocked) return <p role="alert">{blocked}</p>;

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); void search(filters); }} aria-label="Search the audit log" className="filters">
        <label>Actor <input value={filters.actor} onChange={set("actor")} /></label>{" "}
        <label>Action <input value={filters.action} onChange={set("action")} placeholder="e.g. admins.invite" /></label>{" "}
        <label>Target <input value={filters.target} onChange={set("target")} placeholder="email or id" /></label>{" "}
        <label>From <input type="date" value={filters.from} onChange={set("from")} /></label>{" "}
        <label>To <input type="date" value={filters.to} onChange={set("to")} /></label>{" "}
        <button type="submit" className="primary">Search</button>{" "}
        <button type="button" className="link" onClick={() => { setFilters(EMPTY); void search(EMPTY); }}>Clear</button>
      </form>

      {message && <p role="status">{message}</p>}

      {isOwner && (
        <section aria-labelledby="verify-h">
          <h2 id="verify-h">Tamper check</h2>
          <button type="button" onClick={() => void onVerify()}>Verify the chain now</button>
          {report && (
            <p role="status" className={report.ok ? "st st-connected" : "st st-disconnected"}>
              {report.ok
                ? `Intact: ${report.checked} event(s) checked. Head #${report.headSeq}, hash ${report.headHash?.slice(0, 16)}…`
                : `Broken at #${report.brokenAtSeq}: ${report.problem}`}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="events-h">
        <h2 id="events-h">Events</h2>
        {!events ? (
          <p className="muted">Loading…</p>
        ) : events.length === 0 ? (
          <p className="muted">No events match.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Previous</th><th>New</th><th>Reason</th><th>Result</th><th>Status</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.seq}>
                    <td>{e.seq}</td>
                    <td>{new Date(e.at).toLocaleString()}</td>
                    <td>{e.actor}</td>
                    <td>
                      {e.action}{e.sensitive && <strong> · Sensitive</strong>}
                      {e.context && <div className="muted">{e.context}</div>}
                    </td>
                    <td>{e.target ?? "—"}</td>
                    <td>{e.previous ?? "—"}</td>
                    <td>{e.next ?? "—"}</td>
                    <td>{e.reason ?? "—"}</td>
                    <td>{e.result === "Blocked" ? <strong>Blocked</strong> : "Completed"}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next && <button type="button" className="link" onClick={() => void search(filters, next)}>Load older events</button>}
      </section>

      <section aria-labelledby="export-h">
        <h2 id="export-h">Export</h2>
        <form onSubmit={onExport}>
          <p>
            <label htmlFor="export-reason">Reason (required) </label>
            <input id="export-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required size={40} />
          </p>
          <p className="muted">Exports the events matching the search above as CSV (up to 5,000). The export itself is recorded.</p>
          <button type="submit">Export CSV</button>
        </form>
      </section>
    </>
  );
}
