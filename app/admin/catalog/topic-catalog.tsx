"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { call, when } from "../../call";
import { meFrom } from "../../me";
import { batchQueuedFrom, batchQuoteFrom, catalogFrom, type BatchQuote, type Catalog } from "../../activities-api";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** L6: the topic catalog (Owner, Course Admin, Reviewer). The Owner and Course Admins queue topics after seeing the estimate. */
export function TopicCatalog() {
  const [role, setRole] = useState<string | null>(null);
  const [data, setData] = useState<Catalog | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [quote, setQuote] = useState<BatchQuote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/catalog");
    const c = r._status === 200 ? catalogFrom(r) : null;
    setData(c);
    if (!c) setMessage(r.reason ?? "Couldn't load the catalog.");
  }, []);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function estimate() {
    setBusy(true);
    const r = await call("POST", "/api/v1/catalog/queue", { slugs: picked });
    setBusy(false);
    const q = r._status === 200 ? batchQuoteFrom(r) : null;
    if (!q) return setMessage(r.reason ?? "Couldn't estimate the batch.");
    setQuote(q);
    setMessage(null);
  }
  async function confirm() {
    if (!quote) return;
    setBusy(true);
    const r = await call("POST", "/api/v1/catalog/queue", { slugs: picked, confirm: true, expectedTotalUsd: quote.totalUsd });
    setBusy(false);
    const done = r._status === 201 ? batchQueuedFrom(r) : null;
    setMessage(done ? `Queued ${done.queued} topic(s), estimated at up to ${usd(done.totalUsd)}. They start in tonight's run.` : r.reason ?? "Nothing was queued.");
    if (done) { setQuote(null); setPicked([]); }
    await load();
  }
  async function cancel(id: string) {
    const r = await call("POST", `/api/v1/catalog/jobs/${id}/cancel`, {});
    setMessage(r._status === 200 ? "Taken off the queue. Anything already drafted stays as Draft." : r.reason ?? "Nothing was changed.");
    await load();
  }

  if (role && !["owner", "courseAdmin", "reviewer"].includes(role)) return <p>The topic catalog is for the Owner, Course Admins and Reviewers.</p>;
  if (!data) return <p className="muted">{message ?? "Loading…"}</p>;
  const canQueue = role === "owner" || role === "courseAdmin";
  return (
    <>
      {message && <p role="status">{message}</p>}
      {!data.aiOn && <p className="notice">AI is off (no ANTHROPIC_API_KEY): queued topics wait until it is on. Everything else works.</p>}
      <p className="small muted">
        AI spent today {usd(data.spent.day)} of {usd(data.caps.perDay)}; this month {usd(data.spent.month)} of {usd(data.caps.perMonth)}.
        A topic is estimated at up to {usd(data.perTopicUsd)} (about {data.lessonsAssumed} lessons with their practice pools).
      </p>
      <table>
        <caption className="sr-only">Topics and their state</caption>
        <thead><tr>{canQueue && <th scope="col">Queue</th>}<th scope="col">Topic</th><th scope="col">State</th><th scope="col">Batch job</th></tr></thead>
        <tbody>
          {data.topics.map((t) => (
            <tr key={t.slug}>
              {canQueue && (
                <td>
                  <input type="checkbox" aria-label={`Queue ${t.name}`} disabled={!t.canQueue} checked={picked.includes(t.slug)}
                    onChange={(e) => { setQuote(null); setPicked(e.target.checked ? [...picked, t.slug] : picked.filter((s) => s !== t.slug)); }} />
                </td>
              )}
              <td>
                {t.hasCourse ? <Link href={`/admin/courses/${t.slug}`}>{t.name}</Link> : t.name} <span className="muted small">({t.slug} · {t.audience})</span>
                {t.outcome && <div className="small muted">{t.outcome}</div>}
              </td>
              <td><strong>{t.stateLabel}</strong></td>
              <td className="small">
                {t.job ? (
                  <>
                    {t.job.status}{t.job.waitingLabel ? ` · waiting for ${t.job.waitingLabel}` : ""}{t.job.note ? `: ${t.job.note}` : ""}
                    <div className="muted">Queued {when(t.job.queuedAt)}{t.job.lastStepAt ? ` · last step ${when(t.job.lastStepAt)}` : ""}</div>
                    {canQueue && !["done", "canceled", "failed"].includes(t.job.status) && <button type="button" className="link" onClick={() => void cancel(t.job!.id)}>Take off the queue</button>}
                  </>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canQueue && (
        <p>
          <button type="button" disabled={busy || !picked.length} onClick={() => void estimate()}>Estimate the batch ({picked.length} topic{picked.length === 1 ? "" : "s"})</button>
        </p>
      )}
      {quote && (
        <div className="notice" role="region" aria-label="Batch estimate">
          <p><strong>Estimated cost: up to {usd(quote.totalUsd)}</strong> for {quote.topics.length} topic(s): {quote.topics.map((t) => `${t.name} (${usd(t.estimateUsd)})`).join(", ")}.</p>
          <p className="small">{quote.note}</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>Queue for tonight</button>{" "}
          <button type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
        </div>
      )}
      {data.varietyFailures && (
        <section aria-labelledby="variety-h">
          <h2 id="variety-h">Modules that fail the variety rule</h2>
          <p className="small muted">A module is published only with at least 3 different activity types.</p>
          {data.varietyFailures.length === 0 ? <p className="muted">None.</p> : (
            <ul>{data.varietyFailures.map((v) => (
              <li key={v.moduleId}><Link href={`/admin/courses/${v.course}`}>{v.courseName}</Link>: {v.module} has {v.types} of {v.min} types</li>
            ))}</ul>
          )}
        </section>
      )}
    </>
  );
}
