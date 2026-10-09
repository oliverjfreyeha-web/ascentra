"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call, when } from "../../call";
import { checklistFrom, SLOT_STATUS, type Checklist } from "../../studio-api";
import { Loading } from "../../ui/loading";

/** C1: what waits for the Owner: modules ready for approval, modules sent back, empty video slots, and the income-claims check. */
export function ReviewChecklist() {
  const [data, setData] = useState<Checklist | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    call("GET", "/api/v1/review/checklist").then((r) => {
      const c = r._status === 200 ? checklistFrom(r) : null;
      setData(c);
      setFailed(c ? null : r.reason ?? "Couldn't load the checklist.");
    }).catch(() => setFailed("Couldn't load the checklist."));
  }, []);
  if (failed) return <p role="status">{failed}</p>;
  if (!data) return <Loading />;
  if (!data.courses.length) return <p className="muted">No course uses the Owner&apos;s review yet. Start one from Topics (&ldquo;Start course&rdquo;).</p>;
  return (
    <section aria-labelledby="checklist-h">
      <h2 id="checklist-h">Checklist</h2>
      {data.courses.map((c) => (
        <article key={c.slug} className="studio__module" aria-labelledby={`cl-${c.slug}`}>
          <h3 id={`cl-${c.slug}`}><Link href={`/admin/courses/${c.slug}`}>{c.name}</Link> <span className="muted small">· version {c.version}, {c.status}{c.unpublished ? ", unpublished" : ""} · {c.approved} of {c.modules} modules approved</span></h3>
          <dl className="studio__checklist">
            <dt>Waiting for your approval</dt>
            <dd>{c.waiting.length ? <ul>{c.waiting.map((m) => <li key={m.id}>Module {m.position}: {m.title}</li>)}</ul> : <span className="muted">None</span>}</dd>
            <dt>Sent back</dt>
            <dd>{c.sentBack.length ? <ul>{c.sentBack.map((m) => <li key={m.id}>Module {m.position}: {m.title} <span className="muted small">({when(m.at)}): {m.note}</span></li>)}</ul> : <span className="muted">None</span>}</dd>
            <dt>Not ready yet</dt>
            <dd>{c.notReady.length ? <ul>{c.notReady.map((m) => <li key={m.id}>Module {m.position}: {m.title} <span className="muted small">({m.blockers.length} thing{m.blockers.length === 1 ? "" : "s"} to finish)</span></li>)}</ul> : <span className="muted">None</span>}</dd>
            <dt>Video slots without an approved video</dt>
            <dd>{c.emptySlots.length ? <ul>{c.emptySlots.map((s) => <li key={s.id}>Module {s.module}: {s.title} <span className="muted small">({SLOT_STATUS[s.status as keyof typeof SLOT_STATUS] ?? s.status})</span></li>)}</ul> : <span className="muted">None</span>}</dd>
            <dt>Income-claims check</dt>
            <dd>{c.income.ok ? "Nothing found." : <ul>{c.income.findings.map((f, i) => <li key={i}><strong>{f.where}</strong>: &quot;{f.text}&quot; ({f.claim})</li>)}</ul>}</dd>
          </dl>
        </article>
      ))}
    </section>
  );
}
