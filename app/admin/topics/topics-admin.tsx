"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import Link from "next/link";
import { call, when } from "../../call";
import { meFrom } from "../../me";
import { adminTopicsFrom, learnerPicksFrom, type AdminTopic, type LearnerPicks, type Source } from "../../picks-api";
import { Loading } from "../../ui/loading";
import "./topics.css";

/**
 * L8: the Owner and authorized staff (Super Admin, Course Admin) manage topics; the Owner alone changes a learner's business.
 * C2: side hustles have their own tab; businesses and side hustles carry the card estimates (cost to start, outlook,
 * difficulty, risks), each with sources and the date checked. An empty estimate shows "Estimate coming" to learners.
 */
type Kind = "business" | "side_hustle" | "skill";
const KINDS: { key: Kind; label: string; one: string }[] = [
  { key: "business", label: "Businesses", one: "business" }, { key: "side_hustle", label: "Side hustles", one: "side hustle" }, { key: "skill", label: "Skills", one: "skill" },
];
export function TopicsAdmin() {
  const [role, setRole] = useState<string | null>(null);
  const [topics, setTopics] = useState<AdminTopic[] | null>(null);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<Kind>("business");
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

  /** Sends a change; the page-top message says what happened. Returns null when saved, else the refusal (I1: forms also show it next to their Save button). */
  async function save(method: string, url: string, body: unknown, done: string): Promise<string | null> {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const t = r._status < 300 ? adminTopicsFrom(r) : null;
    if (t) setTopics(t.topics);
    const refusal = t ? null : r.reason ?? "Nothing was changed.";
    setMessage(t ? done : refusal);
    return refusal;
  }
  const send = async (method: string, url: string, body: unknown, done: string) => (await save(method, url, body, done)) === null;

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
        {KINDS.map((k) => <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
      </div>
      {message && <p role="status">{message}</p>}
      {note && <p className="small muted">{note}</p>}
      {topics === null ? <Loading shape="table" /> : (
        <div className="ui-table-wrap">
          <table className="topics__table">
            <caption className="sr-only">{KINDS.find((k) => k.key === kind)!.label}</caption>
            <thead><tr><th scope="col">Topic</th><th scope="col">Shown</th><th scope="col">Teens</th><th scope="col">Course (none, drafting, in review, published)</th><th scope="col">Demand (30 days / all)</th><th scope="col">Picked now</th><th scope="col">Order</th></tr></thead>
            <tbody>
              {list.map((t, i) => (
                <tr key={t.id}>
                  <td>
                    <EditTopic t={t} busy={busy} onSave={(name, blurb) => save("PATCH", `/api/v1/topics/${t.id}`, { name, blurb }, `${name}: saved.`)} />
                    {t.kind !== "skill" && t.facts && <EditFacts t={t} busy={busy} onSave={(body) => save("PATCH", `/api/v1/topics/${t.id}`, body, `${t.name}: estimates saved.`)} />}
                  </td>
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
      <AddTopic kind={kind} busy={busy} onAdd={(body) => save("POST", "/api/v1/topics", body, `Added ${String(body.name)} (unpublished until you publish it).`)} />
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
  // C2: the course size (Compact 3-4 modules, Standard 5-6, Large 7-9); the Blueprint is built to fit it.
  const [sizeTier, setSizeTier] = useState("standard");
  const url = `/api/v1/topics/${t.id}/course`;
  async function ask() {
    setBusy(true);
    const r = await call("POST", url, { sizeTier });
    setBusy(false);
    const total = (r.quote as { totalUsd?: number } | undefined)?.totalUsd;
    if (r._status === 200 && typeof total === "number") setQuote(total);
    else onDone(r.reason ?? "Couldn't get the estimate.");
  }
  async function confirm() {
    setBusy(true);
    const r = await call("POST", url, { confirm: true, expectedTotalUsd: quote, sizeTier });
    setBusy(false);
    setQuote(null);
    onDone(r._status < 300 ? `${t.name}: course queued. It runs overnight and stops when a person is needed: source approval, Blueprint approval, review, then your approval of each module.` : r.reason ?? "Nothing was queued.");
  }
  if (quote === null) return (
    <div className="small">
      <label>Size <select value={sizeTier} onChange={(e) => setSizeTier(e.target.value)}>
        <option value="compact">Compact (3-4 modules)</option><option value="standard">Standard (5-6 modules)</option><option value="large">Large (7-9 modules)</option>
      </select><span className="sr-only"> for {t.name}</span></label>{" "}
      <button type="button" className="link small" disabled={busy} onClick={ask}>Start course<span className="sr-only">: {t.name}</span></button>
    </div>
  );
  return (
    <div className="small">
      Estimated AI cost: up to ${quote.toFixed(2)}.{" "}
      <button type="button" className="link" disabled={busy} onClick={confirm}>Confirm and queue<span className="sr-only">: {t.name}</span></button>{" · "}
      <button type="button" className="link" disabled={busy} onClick={() => setQuote(null)}>Cancel</button>
    </div>
  );
}

function EditTopic({ t, busy, onSave }: { t: AdminTopic; busy: boolean; onSave: (name: string, blurb: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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
    <form className="ui-form" aria-label={`Edit ${t.name}`} onSubmit={(e) => { e.preventDefault(); void onSave(name, blurb).then((r) => { setRefusal(r); if (r === null) setOpen(false); }); }}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label>Description <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} rows={2} /></label>
      <p className="ui-actions">
        <button type="submit" disabled={busy || name.trim().length < 2}>Save</button> <button type="button" onClick={() => { setRefusal(null); setOpen(false); }}>Cancel</button>
        {refusal && <span role="alert" className="topics__refusal">{refusal}</span>}
      </p>
    </form>
  );
}

/** I1: the exact line format for a source, shown as placeholder text. */
export const SOURCE_PLACEHOLDER = "Title | https://link";
const sourcesText = (list: Source[]) => list.map((x) => `${x.title} | ${x.url}`).join("\n");
const sourcesFrom = (text: string): Source[] => text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [title, url] = l.split("|").map((x) => x.trim());
  return { title: title ?? "", url: url ?? "" };
});

/** C2: the card estimates, entered by the Owner (or staff) with sources and the date checked. Never invented. */
function EditFacts({ t, busy, onSave }: { t: AdminTopic; busy: boolean; onSave: (body: Record<string, unknown>) => Promise<string | null> }) {
  const f = t.facts!;
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [v, setV] = useState({
    costLow: f.costLow?.toString() ?? "", costHigh: f.costHigh?.toString() ?? "", costItems: f.costItems.join("\n"), costSources: sourcesText(f.costSources), costCheckedOn: f.costCheckedOn ?? "",
    outlookLabel: f.outlookLabel ?? "", outlookSources: sourcesText(f.outlookSources), outlookCheckedOn: f.outlookCheckedOn ?? "", difficulty: f.difficulty?.toString() ?? "", riskNotes: f.riskNotes ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const id = `facts-${t.id}`;
  if (!open) return (
    <div className="small">
      {t.card?.cost ? `Cost ${t.card.cost.range}` : "Cost: Estimate coming"} · {t.card?.outlook ? `Outlook ${t.card.outlook.label}` : "Outlook: Estimate coming"}{" "}
      <button type="button" className="link small" onClick={() => setOpen(true)}>Edit estimates<span className="sr-only">: {t.name}</span></button>
    </div>
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    const num = (x: string) => (x.trim() === "" ? null : Number(x));
    void onSave({
      costLow: num(v.costLow), costHigh: num(v.costHigh), costItems: v.costItems.split("\n").map((x) => x.trim()).filter(Boolean), costSources: sourcesFrom(v.costSources),
      costCheckedOn: v.costCheckedOn || null, outlookLabel: v.outlookLabel || null, outlookSources: sourcesFrom(v.outlookSources), outlookCheckedOn: v.outlookCheckedOn || null,
      difficulty: num(v.difficulty), riskNotes: v.riskNotes,
    }).then((r) => { setRefusal(r); if (r === null) setOpen(false); });
  }
  return (
    <form className="ui-form" aria-label={`Estimates for ${t.name}`} onSubmit={submit}>
      <p className="small muted">Learners see &ldquo;Estimate, not a promise. Checked (date). Sources.&rdquo; A number shows only with its sources and date; otherwise &ldquo;Estimate coming&rdquo;. No income claims.</p>
      <fieldset>
        <legend>Cost to start (US dollars)</legend>
        <label>Lowest <input inputMode="decimal" value={v.costLow} onChange={set("costLow")} size={8} /></label>{" "}
        <label>Highest <input inputMode="decimal" value={v.costHigh} onChange={set("costHigh")} size={8} /></label>
        <label>What it covers (one per line) <textarea id={`${id}-items`} rows={2} value={v.costItems} onChange={set("costItems")} /></label>
        <label>Sources (one per line: title | https link) <textarea rows={2} value={v.costSources} onChange={set("costSources")} placeholder={SOURCE_PLACEHOLDER} /></label>
        <label>Checked on <input type="date" value={v.costCheckedOn} onChange={set("costCheckedOn")} /></label>
      </fieldset>
      <fieldset>
        <legend>Market outlook</legend>
        <label>Outlook <select value={v.outlookLabel} onChange={set("outlookLabel")}>
          <option value="">Not set (Estimate coming)</option><option value="growing">Growing</option><option value="steady">Steady</option><option value="shrinking">Shrinking</option><option value="unclear">Unclear</option>
        </select></label>
        <label>Sources (one per line: title | https link) <textarea rows={2} value={v.outlookSources} onChange={set("outlookSources")} placeholder={SOURCE_PLACEHOLDER} /></label>
        <label>Checked on <input type="date" value={v.outlookCheckedOn} onChange={set("outlookCheckedOn")} /></label>
      </fieldset>
      <label>Difficulty (1 easiest to 5) <select value={v.difficulty} onChange={set("difficulty")}><option value="">Not set</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label>Risks <textarea rows={2} maxLength={600} value={v.riskNotes} onChange={set("riskNotes")} /></label>
      <p className="ui-actions">
        <button type="submit" disabled={busy} aria-describedby={refusal ? `${id}-refusal` : undefined}>Save estimates</button> <button type="button" onClick={() => { setRefusal(null); setOpen(false); }}>Cancel</button>
        {refusal && <span id={`${id}-refusal`} role="alert" className="topics__refusal">{refusal}</span>}
      </p>
    </form>
  );
}

function AddTopic({ kind, busy, onAdd }: { kind: Kind; busy: boolean; onAdd: (body: Record<string, unknown>) => Promise<string | null> }) {
  const one = KINDS.find((k) => k.key === kind)!.one;
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [teenHidden, setTeenHidden] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    // A refusal keeps what was typed and says why next to the button.
    const r = await onAdd({ kind, name, blurb, teenHidden });
    setRefusal(r);
    if (r === null) { setName(""); setBlurb(""); setTeenHidden(false); }
  }
  return (
    <form onSubmit={submit} className="ui-block ui-form" aria-label={`Add a ${one}`}>
      <h2>Add a {one}</h2>
      <p className="small muted">New topics start unpublished, so you can check them first. No income claims and no &ldquo;attorney approved&rdquo; wording: both are refused.</p>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <label>Description <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={300} rows={2} /></label>
      <label><input type="checkbox" checked={teenHidden} onChange={(e) => setTeenHidden(e.target.checked)} /> Hide from teens (14 to 17)</label>
      <p className="ui-actions">
        <button type="submit" disabled={busy || name.trim().length < 2}>Add</button>
        {refusal && <span role="alert" className="topics__refusal">{refusal}</span>}
      </p>
    </form>
  );
}

/** The Owner only: a learner's locked business or side hustle can be changed, or released so they choose again. Needs a reason; audited. */
function LearnerBusiness() {
  const verified = useReverification(call);
  const [which, setWhich] = useState<"business" | "side_hustle">("business");
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
    const r = await verified("POST", "/api/v1/topics/learner", { accountId: found.accountId, slug: next, reason, kind: which });
    const f = r && r._status === 200 ? learnerPicksFrom(r) : null;
    if (f) { setFound(f); setReason(""); }
    const label = which === "business" ? "business" : "side hustle";
    setMessage(f ? (next ? `The ${label} was changed. Recorded in the audit log with your reason.` : `Released: the learner can choose a ${label} again. Recorded with your reason.`) : r?.reason ?? "Nothing was changed.");
  }
  const current = found?.found ? found.picks.find((p) => p.kind === which && p.status === "active") : null;
  const sideNow = found?.found ? found.picks.find((p) => p.kind === "side_hustle" && p.status === "active") : null;
  const options = found?.found ? (which === "business" ? found.businesses : found.sideHustles ?? []) : [];
  return (
    <section className="ui-block" aria-labelledby="learner-business-h">
      <h2 id="learner-business-h">A learner&apos;s business or side hustle (Owner only)</h2>
      <p className="small muted">On Basic and the free trial a learner&apos;s business and side hustle lock once chosen. Only you can change them, with a reason that goes in the audit log.</p>
      <form onSubmit={lookup} className="ui-actions">
        <label>Learner&apos;s email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>{" "}
        <button type="submit" disabled={!email.includes("@")}>Look up</button>
      </form>
      {message && <p role="status">{message}</p>}
      {found?.found && (
        <>
          <p>{found.email}{found.teen ? " (teen)" : ""} · plan: {found.plan ?? "none"}</p>
          <ul className="small">{found.picks.map((p) => <li key={p.slug}>{p.kind}: {p.name}, {p.status === "active" ? "active" : "set aside"}{p.locked ? ", locked" : ""} · picked {when(p.pickedAt)}</li>)}</ul>
          <p className="small">Side hustle now: {sideNow ? `${sideNow.name}${sideNow.locked ? " (locked)" : ""}` : "none"}</p>
          <fieldset className="ui-actions">
            <legend>Which one to change</legend>
            <label><input type="radio" name="which" checked={which === "business"} onChange={() => { setWhich("business"); setSlug(""); }} /> Business ({current && which === "business" ? current.name : found.picks.find((p) => p.kind === "business" && p.status === "active")?.name ?? "none"})</label>{" "}
            <label><input type="radio" name="which" checked={which === "side_hustle"} onChange={() => { setWhich("side_hustle"); setSlug(""); }} /> Side hustle ({sideNow?.name ?? "none"})</label>
          </fieldset>
          <p className="ui-actions">
            <label>Change to <select value={slug} onChange={(e) => setSlug(e.target.value)}><option value="">Choose…</option>{options.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}</select></label>{" "}
            <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} size={30} maxLength={500} /></label>
          </p>
          <p className="ui-actions">
            <button type="button" disabled={!slug || reason.trim().length < 5} onClick={() => void change(slug)}>Change {which === "business" ? "business" : "side hustle"}</button>{" "}
            <button type="button" disabled={!current || reason.trim().length < 5} onClick={() => void change(null)}>Release (let them choose again)</button>
          </p>
        </>
      )}
    </section>
  );
}
