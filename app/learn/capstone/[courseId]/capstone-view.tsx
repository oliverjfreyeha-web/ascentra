"use client";

import { useEffect, useState } from "react";
import { call } from "../../../call";
import { capstoneFrom, type LearnerCapstone } from "../../../progress-api";
import { Loading } from "../../../ui/loading";
import "../../c2.css";

/**
 * C2: the course's capstone: deliverables and a self-check list, ticked by the learner. When every box is ticked the
 * capstone counts as done; "Course complete" needs every module done too. A business course adds "Automation with
 * AI": what gets automated, master prompts, and AI plans only as the Owner listed them (or "a paid plan may be needed").
 */
export function CapstoneView({ courseId }: { courseId: string }) {
  const [c, setC] = useState<LearnerCapstone | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/v1/learn/capstones/${encodeURIComponent(courseId)}`;
  function take(v: LearnerCapstone) {
    setC(v);
    setChecked(Object.fromEntries([...v.deliverables, ...v.checklist].map((x) => [x.key, x.checked])));
  }
  useEffect(() => {
    void call("GET", url).then((r) => {
      const v = r._status === 200 ? capstoneFrom(r) : null;
      if (v) take(v);
      setFailed(v ? null : r.reason ?? "Couldn't load the capstone.");
    });
  }, [url]);
  async function save() {
    setBusy(true);
    const r = await call("PUT", url, { checked });
    setBusy(false);
    const v = r._status === 200 ? capstoneFrom(r) : null;
    if (v) take(v);
    setMessage(v ? (v.completedAt ? (v.courseComplete ? "Capstone done. Course complete." : "Capstone done. Finish every module to complete the course.") : "Saved.") : r.reason ?? "Nothing was saved.");
  }
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!c) return <Loading shape="list" />;
  const box = (x: { key: string; text: string }) => (
    <li key={x.key}><label><input type="checkbox" checked={!!checked[x.key]} disabled={!!c.completedAt} onChange={(e) => setChecked({ ...checked, [x.key]: e.target.checked })} /> {x.text}</label></li>
  );
  return (
    <>
      <header className="ui-page-head">
        <p className="ui-eyebrow">Capstone</p>
        <h1>{c.title}</h1>
      </header>
      {message && <p role="status">{message}</p>}
      <p className="small">{c.courseComplete ? "Course complete." : c.completedAt ? "Capstone done." : "Required: the course is complete when every module and this capstone are done."}</p>
      {c.brief && <p>{c.brief}</p>}
      <section className="ui-block" aria-labelledby="deliv-h">
        <h2 id="deliv-h">Deliverables</h2>
        <ul className="c2-checks">{c.deliverables.map(box)}</ul>
        <h2>Self-check</h2>
        <ul className="c2-checks">{c.checklist.map(box)}</ul>
        {!c.completedAt && <p className="ui-actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}>Save</button></p>}
      </section>
      {c.automation && (
        <section className="ui-block" aria-labelledby="auto-h">
          <h2 id="auto-h">Automation with AI</h2>
          <p>{c.automation.what}</p>
          {c.automation.prompts.length > 0 && (
            <>
              <h3>Master prompts</h3>
              <ol>{c.automation.prompts.map((p, i) => <li key={i}><pre className="c2-summary">{p}</pre></li>)}</ol>
            </>
          )}
          <h3>AI plans</h3>
          {c.automation.plans.length ? (
            <ul className="ui-rows">
              {c.automation.plans.map((p) => (
                <li key={p.name}><span>{p.name}: {p.price}</span><span className="small muted">checked {p.checkedOn} · <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">source<span className="sr-only"> for {p.name} (opens in a new tab)</span></a></span></li>
              ))}
            </ul>
          ) : <p className="small muted">{c.automation.paidPlanNote}</p>}
          <p className="small muted">Prices change. Check the source before you buy anything. Not sponsored.</p>
        </section>
      )}
    </>
  );
}
