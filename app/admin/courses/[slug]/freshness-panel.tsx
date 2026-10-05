"use client";

import { useState } from "react";
import { call, when, type ApiResult } from "../../../call";
import { can, usd, type Freshness, type RefreshReport } from "../../../courses-api";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "not yet");
const PACE: Record<string, string> = { quick: "changing quickly", moderate: "changing moderately", stable: "mostly stable", unclear: "unclear" };
const STATUS: Record<string, string> = { idle: "", queued: "Queued for the next run", running: "Running now", waiting_cap: "Waiting for the spend cap", failed: "Last run failed" };

/**
 * L3: the course's freshness cycle. The refresh interval (the Owner sets it), when the course was last verified and
 * when it is next due, the queue, and the change reports: source checks, new PROPOSED sources, the market signal,
 * doubtful paragraphs and suggested edits. A Reviewer approves edits (each goes into a NEW Draft of its lesson) and
 * closes the report. Nothing here changes what learners see until a new version is published.
 */
export function FreshnessPanel({ slug, freshness, reports, role, busy, act }: {
  slug: string; freshness: Freshness; reports: RefreshReport[]; role: string | null; busy: boolean;
  act: (run: () => Promise<ApiResult>, okText: (r: ApiResult) => string, pending?: string) => Promise<void>;
}) {
  const [days, setDays] = useState(String(freshness.days));
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const base = `/api/v1/courses/${encodeURIComponent(slug)}/refresh`;
  const open = reports.find((r) => r.status === "ready" || r.status === "running");
  const latest = open ?? reports[0];
  const canReview = can("verify", role);

  return (
    <section aria-labelledby="fresh-h">
      <h2 id="fresh-h">Freshness</h2>
      <p>
        Last verified: <strong>{day(freshness.lastVerifiedAt)}</strong> · next refresh: <strong>{day(freshness.nextRefreshAt)}</strong>
        {freshness.due ? " (due)" : ""} · every {freshness.days} days
        {freshness.staleLessons.length > 0 && <> · <strong>{freshness.staleLessons.length} lesson(s) stale</strong> (past their refresh date with no review)</>}
      </p>
      {(freshness.status !== "idle" || freshness.note) && <p className="notice">{STATUS[freshness.status]}{freshness.note ? `: ${freshness.note}` : ""}</p>}
      {role === "owner" && (
        <p>
          <label>Refresh every <input type="number" min={30} max={60} value={days} onChange={(e) => setDays(e.target.value)} style={{ width: "4em" }} /> days (30 to 60)</label>{" "}
          <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>{" "}
          <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void act(() => call("PATCH", base, { days: Number(days), reason }), (r) => `Refresh interval set to ${r.days} days.`)}>Save</button>
        </p>
      )}
      {can("research", role) && !open && freshness.status !== "queued" && (
        <p>
          <button type="button" disabled={busy} onClick={() => void act(() => call("POST", base), (r) => `Queued. It runs with the nightly job (or when the job is run by hand); estimated up to ${usd(Number(r.estimateUsd))}.`)}>
            Queue a refresh (up to {usd(freshness.estimateUsd)})
          </button>{" "}
          <span className="muted small">Re-checks the sources and researches what has changed. It never changes what learners see.</span>
        </p>
      )}

      {latest && (
        <div className="notice">
          <h3>Change report · {latest.status === "ready" ? "waiting for review" : latest.status} · {when(latest.startedAt)} ({latest.trigger})</h3>
          <p className="muted small">Since {day(latest.since)} · cost {usd(latest.costUsd)}{latest.reviewedAt ? ` · closed ${when(latest.reviewedAt)}: ${latest.reviewNote}` : ""}</p>
          {latest.error && <p className="notice">{latest.error}</p>}

          <h4>Market signal: {PACE[latest.marketSignal.pace]}</h4>
          <p className="muted small">Observations from the sources, not predictions. Use it to decide how urgently to review.</p>
          {latest.marketSignal.notes.length ? (
            <ul>{latest.marketSignal.notes.map((n, i) => <li key={i}>{n.text} <span className="muted small">{n.sources.map((s) => s.title ?? s.url).join("; ") || "no source"}</span></li>)}</ul>
          ) : <p className="muted small">No notes.</p>}

          <h4>Sources re-checked</h4>
          <ul>
            {latest.sourceChecks.map((c) => (
              <li key={c.sourceId}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a> : c.title}: <strong>{c.result}</strong> <span className="muted small">{c.detail}</span></li>
            ))}
          </ul>

          {latest.newSources.length > 0 && (
            <>
              <h4>Newly found sources (proposed: approve one before a lesson can cite it)</h4>
              <ul>
                {latest.newSources.map((s) => (
                  <li key={s.id}>
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title} <span className="muted small">· {s.status}{s.pageAge ? ` · dated ${s.pageAge}` : ""}</span>{" "}
                    {canReview && s.status === "proposed" && (
                      <button type="button" className="link" disabled={busy} onClick={() => {
                        const why = window.prompt(`Reason for approving "${s.title}" (recorded):`)?.trim();
                        if (why) void act(() => call("POST", `/api/v1/sources/${s.id}/approve`, { reason: why }), () => "Source approved.");
                      }}>Approve source</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h4>Doubtful or outdated ({latest.doubtful.length})</h4>
          {latest.doubtful.length ? (
            <ul>{latest.doubtful.map((d, i) => <li key={i}><strong>{d.lessonTitle}</strong> ({d.paragraph}, {d.kind.replace("_", " ")}): {d.reason} <span className="muted small">“{d.text.slice(0, 160)}…”</span></li>)}</ul>
          ) : <p className="muted small">Nothing flagged.</p>}

          <h4>Suggested edits ({latest.edits.length})</h4>
          {latest.edits.length === 0 && <p className="muted small">None.</p>}
          {latest.edits.map((e) => (
            <div key={e.id} className="notice">
              <p><strong>{e.lessonTitle}</strong> · {e.location} · <em>{e.status}</em>{e.draftVersionId ? " · in a Draft below" : ""}</p>
              <p className="small"><del>{e.oldText}</del></p>
              <p className="small"><ins>{e.newText}</ins></p>
              <p className="muted small">Why: {e.reason} · Sources: {e.sources.map((s) => `${s.title} (${s.status})`).join("; ")}</p>
              {canReview && e.status === "suggested" && latest.status === "ready" && (
                <p>
                  <button type="button" disabled={busy} onClick={() => void act(() => call("POST", `${base}/edits/${e.id}`, { decision: "approve" }),
                    () => "Approved. It's in a new Draft of the lesson below: submit, verify and publish it as usual. Any proposed source it cites must be approved first.")}>Approve edit</button>{" "}
                  <button type="button" disabled={busy} onClick={() => void act(() => call("POST", `${base}/edits/${e.id}`, { decision: "reject" }), () => "Rejected.")}>Reject</button>
                </p>
              )}
            </div>
          ))}

          {canReview && latest.status === "ready" && (
            <p>
              <label>What you reviewed <input value={note} onChange={(e) => setNote(e.target.value)} size={50} /></label>{" "}
              <button type="button" disabled={busy || note.trim().length < 5} onClick={() => void act(() => call("POST", `${base}/reports/${latest.id}/close`, { note }),
                () => "Report closed. The course is verified as of today; its next refresh date moves.")}>Close report</button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
