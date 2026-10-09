"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import Link from "next/link";
import { call, when } from "../../call";
import { meFrom } from "../../me";
import { adminTopicsFrom, learnerPicksFrom, type AdminTopic, type LearnerPicks } from "../../picks-api";
import { Loading } from "../../ui/loading";

/** L8: the Owner and authorized staff (Super Admin, Course Admin) manage topics; the Owner alone changes a learner's business. */
export function TopicsAdmin() {
  const [role, setRole] = useState<string | null>(null);
  const [topics, setTopics] = useState<AdminTopic[] | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"business" | "skill">("business");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/topics");
    const t = r._status === 200 ? adminTopicsFrom(r) : null;
    setTopics(t?.topics ?? null);
    setNote(t?.note ?? "");
    if (!t) setMessage(r.reason ?? "Couldn't load the topics.");
  }, []);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function send(method: string, url: string, body: unknown, done: string) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const t = r._status < 300 ? adminTopicsFrom(r) : null;
    if (t) setTopics(t.topics);
    setMessage(t ? done : r.reason ?? "Nothing was changed.");
    return !!t;
  }

  if (role && !["owner", "superAdmin", "courseAdmin"].includes(role)) return <p>Topics are managed by the Owner, Super Admins and Course Admins.</p>;
  const list = (topics ?? []).filter((t) => t.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder);
  const move = (i: number, d: -1 | 1) => {
    const o = list.map((t) => t.slug);
    [o[i], o[i + d]] = [o[i + d], o[i]];
    void send("PUT", "/api/v1/topics/order", { kind, order: o }, "Order saved.");
  };
  const toggle = (t: AdminTopic, field: "published" | "teenHidden" | "hasCourse", label: string) =>
    void send("PATCH", `/api/v1/topics/${t.id}`, { [field]: !t[field] }, `${t.name}: ${label}.`);
  return (
    <>
      <div role="group" aria-label="Kind" className="ui-actions">
        <button type="button" aria-pressed={kind === "business"} onClick={() => setKind("business")}>Businesses</button>{" "}
        <button type="button" aria-pressed={kind === "skill"} onClick={() => setKind("skill")}>Skills</button>
      </div>
      {message && <p role="status">{message}</p>}
      {note && <p className="small muted">{note}</p>}
      {topics === null ? <Loading shape="table" /> : (
        <div className="ui-table-wrap">
          <table>
            <caption className="sr-only">{kind === "business" ? "Businesses" : "Skills"}</caption>
            <thead><tr><th scope="col">Topic</th><th scope="col">Shown</th><th scope="col">Teens</th><th scope="col">Course (none, drafting, in review, published)</th><th scope="col">Demand (30 days / all)</th><th scope="col">Picked now</th><th scope="col">Order</th></tr></thead>
            <tbody>
              {list.map((t, i) => (
                <tr key={t.id}>
                  <td><EditTopic t={t} busy={busy} onSave={(name, blurb) => send("PATCH", `/api/v1/topics/${t.id}`, { name, blurb }, `${name}: saved.`)} /></td>
                  <td><button type="button" className="link" disabled={busy} onClick={() => toggle(t, "published", t.published ? "unpublished" : "published")}>{t.published ? "Published" : "Unpublished"}<span className="sr-only">: {t.name}. Select to {t.published ? "unpublish" : "publish"}.</span></button></td>
                  <td><button type="button" className="link" disabled={busy} onClick={() => toggle(t, "teenHidden", t.teenHidden ? "shown to teens" : "hidden from teens")}>{t.teenHidden ? "Hidden from teens" : "Shown to teens"}<span className="sr-only">: {t.name}. Select to {t.teenHidden ? "show to teens" : "hide from teens"}.</span></button></td>
                  <td>
                    {t.catalogSlug ? (
                      // C1: linked to a course: its status, and "Course coming" until it is published.
                      <><Link href={`/admin/courses/${t.catalogSlug}`}>{t.course?.label ?? "None"}<span className="sr-only">: course for {t.name}</span></Link>
                        <div className="small muted">{t.hasCourse ? "Learners can open it" : "Learners see “Course coming”"}</div></>
                    ) : (
                      <button type="button" className="link" disabled={busy} onClick={() => toggle(t, "hasCourse", t.hasCourse ? "course coming" : "has a course")}>{t.hasCourse ? "Has a course" : "Course coming"}<span className="sr-only">: {t.name}. Select to mark {t.hasCourse ? "course coming" : "has a course"}.</span></button>
                    )}
                    {(role === "owner" || role === "courseAdmin") && (!t.course || t.course.status === "none") && <StartCourse t={t} onDone={(m) => { setMessage(m); void load(); }} />}
                  </td>
                  <td>{t.demand30} / {t.demandAll}</td>
                  <td>{t.activePicks}</td>
                  <td className="small">
                    <button type="button" className="link" disabled={busy || i === 0} aria-label={`Move up: ${t.name}`} onClick={() => move(i, -1)}>Up</button>{" · "}
                    <button type="button" className="link" disabled={busy || i === list.length - 1} aria-label={`Move down: ${t.name}`} onClick={() => move(i, 1)}>Down</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddTopic kind={kind} busy={busy} onAdd={(body) => send("POST", "/api/v1/topics", body, `Added ${String(body.name)} (unpublished until you publish it).`)} />
      {role === "owner" && <LearnerBusiness />}
    </>
  );
}

/**
 * C1: starts a topic's course through the usual steps (research, Blueprint, drafting), built with the module recipe:
 * first the cost estimate, then the same total confirmed. Nothing is generated per learner, and no video is made.
 */
function StartCourse({ t, onDone }: { t: AdminTopic; onDone: (message: string) => void }) {
  const [quote, setQuote] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/v1/topics/${t.id}/course`;
  async function ask() {
    setBusy(true);
    const r = await call("POST", url, {});
    setBusy(false);
    const total = (r.quote as { totalUsd?: number } | undefined)?.totalUsd;
    if (r._status === 200 && typeof total === "number") setQuote(total);
    else onDone(r.reason ?? "Couldn't get the estimate.");
  }
  async function confirm() {
    setBusy(true);
    const r = await call("POST", url, { confirm: true, expectedTotalUsd: quote });
    setBusy(false);
    setQuote(null);
    onDone(r._status < 300 ? `${t.name}: course queued. It runs overnight and stops when a person is needed: source approval, Blueprint approval, review, then your approval of each module.` : r.reason ?? "Nothing was queued.");
  }
  if (quote === null) return <div><button type="button" className="link small" disabled={busy} onClick={ask}>Start course<span className="sr-only">: {t.name}</span></button></div>;
  return (
    <div className="small">
      Estimated AI cost: up to ${quote.toFixed(2)}.{" "}
      <button type="button" className="link" disabled={busy} onClick={confirm}>Confirm and queue<span className="sr-only">: {t.name}</span></button>{" · "}
      <button type="button" className="link" disabled={busy} onClick={() => setQuote(null)}>Cancel</button>
    </div>
  );
}

function EditTopic({ t, busy, onSave }: { t: AdminTopic; busy: boolean; onSave: (name: string, blurb: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(t.name);
  const [blurb, setBlurb] = useState(t.blurb);
  if (!open) return (
    <>
      <strong>{t.name}</strong> <span className="small muted">({t.slug})</span>
      <div className="small">{t.blurb}</div>
      <button type="button" className="link small" onClick={() => setOpen(true)} aria-label={`Edit ${t.name}`}>Edit</button>
    </>
  );
  return (
    <form className="ui-form" aria-label={`Edit ${t.name}`} onSubmit={(e) => { e.preventDefault(); void onSave(name, blurb).then((ok) => { if (ok) setOpen(false); }); }}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label>Description <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} rows={2} /></label>
      <p className="ui-actions"><button type="submit" disabled={busy || name.trim().length < 2}>Save</button> <button type="button" onClick={() => setOpen(false)}>Cancel</button></p>
    </form>
  );
}

function AddTopic({ kind, busy, onAdd }: { kind: "business" | "skill"; busy: boolean; onAdd: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [teenHidden, setTeenHidden] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onAdd({ kind, name, blurb, teenHidden })) { setName(""); setBlurb(""); setTeenHidden(false); }
  }
  return (
    <form onSubmit={submit} className="ui-block ui-form" aria-label={`Add a ${kind}`}>
      <h2>Add a {kind}</h2>
      <p className="small muted">New topics start unpublished, so you can check them first. No income claims and no &ldquo;attorney approved&rdquo; wording: both are refused.</p>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label>Description <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} rows={2} /></label>
      <label><input type="checkbox" checked={teenHidden} onChange={(e) => setTeenHidden(e.target.checked)} /> Hide from teens (14 to 17)</label>
      <p className="ui-actions"><button type="submit" disabled={busy || name.trim().length < 2}>Add</button></p>
    </form>
  );
}

/** The Owner only: a learner's locked business can be changed, or released so they choose again. Needs a reason; audited. */
function LearnerBusiness() {
  const verified = useReverification(call);
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<LearnerPicks | null>(null);
  const [slug, setSlug] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function lookup(e: FormEvent) {
    e.preventDefault();
    const r = await call("GET", `/api/v1/topics/learner?email=${encodeURIComponent(email)}`);
    const f = r._status === 200 ? learnerPicksFrom(r) : null;
    setFound(f);
    setMessage(f ? (f.found ? null : "No learner with that email.") : r.reason ?? "Couldn't look that up.");
  }
  async function change(next: string | null) {
    if (!found?.found) return;
    const r = await verified("POST", "/api/v1/topics/learner", { accountId: found.accountId, slug: next, reason });
    const f = r && r._status === 200 ? learnerPicksFrom(r) : null;
    if (f) { setFound(f); setReason(""); }
    setMessage(f ? (next ? "Business changed. Recorded in the audit log with your reason." : "Released: the learner can choose a business again. Recorded with your reason.") : r?.reason ?? "Nothing was changed.");
  }
  const current = found?.found ? found.picks.find((p) => p.kind === "business" && p.status === "active") : null;
  return (
    <section className="ui-block" aria-labelledby="learner-business-h">
      <h2 id="learner-business-h">A learner&apos;s business (Owner only)</h2>
      <p className="small muted">On Basic and the free trial a learner&apos;s business locks once chosen. Only you can change it, with a reason that goes in the audit log.</p>
      <form onSubmit={lookup} className="ui-actions">
        <label>Learner&apos;s email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>{" "}
        <button type="submit" disabled={!email.includes("@")}>Look up</button>
      </form>
      {message && <p role="status">{message}</p>}
      {found?.found && (
        <>
          <p>{found.email}{found.teen ? " (teen)" : ""} · plan: {found.plan ?? "none"} · business: {current ? `${current.name}${current.locked ? " (locked)" : ""}` : "none"}</p>
          <ul className="small">{found.picks.map((p) => <li key={p.slug}>{p.kind}: {p.name}, {p.status === "active" ? "active" : "set aside"}{p.locked ? ", locked" : ""} · picked {when(p.pickedAt)}</li>)}</ul>
          <p className="ui-actions">
            <label>Change to <select value={slug} onChange={(e) => setSlug(e.target.value)}><option value="">Choose…</option>{found.businesses.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}</select></label>{" "}
            <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} size={30} maxLength={500} /></label>
          </p>
          <p className="ui-actions">
            <button type="button" disabled={!slug || reason.trim().length < 5} onClick={() => void change(slug)}>Change business</button>{" "}
            <button type="button" disabled={!current || reason.trim().length < 5} onClick={() => void change(null)}>Release (let them choose again)</button>
          </p>
        </>
      )}
    </section>
  );
}
