"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { call } from "../../call";
import { courseRequestFrom, interviewFrom, interviewSavedFrom, pathFrom, type InterviewInfo, type PathView } from "../../path-api";
import { CountUp } from "../../ui/count-up";
import { Loading } from "../../ui/loading";

/**
 * L7: the interview (four questions, each from a list: nothing personal can be typed in) and the path it builds from
 * published courses: in order, with why each was chosen, the estimated time and each course's "last verified" date.
 * The learner can reorder, remove, add (within their plan), redo the interview, or delete their answers.
 */
export function PathPage() {
  const [info, setInfo] = useState<InterviewInfo | null>(null);
  const [path, setPath] = useState<PathView | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [i, p] = await Promise.all([call("GET", "/api/v1/learn/interview"), call("GET", "/api/v1/learn/path")]);
    setInfo(i._status === 200 ? interviewFrom(i) : null);
    const pv = p._status === 200 ? pathFrom(p) : null;
    setPath(pv);
    if (!pv) setMessage(p.reason ?? "Couldn't load your path.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function change(method: string, url: string, body?: unknown) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const pv = r._status < 300 ? pathFrom(r) : null;
    if (pv) setPath(pv);
    setMessage(r._status < 300 ? null : r.reason ?? "Nothing was changed.");
    if (!pv) await load();
  }

  if (!info || !path) return message ? <p className="muted ui-state ui-state--error">{message}</p> : <Loading shape="list" />;
  const showInterview = editing || path.interviewNeeded;
  return (
    <>
      {message && <p role="status">{message}</p>}
      {showInterview ? (
        <Interview info={info} onDone={(m, pv) => { setEditing(false); setMessage(m); if (pv) setPath(pv); void load(); }} onCancel={path.interviewNeeded ? null : () => setEditing(false)} />
      ) : (
        <>
          {path.interview ? (
            <p className="small ui-answers">Your answers: {path.interview.goal} · {path.interview.level} · {path.interview.minutesPerWeek} minutes a week.{" "}
              <button type="button" className="link" onClick={() => setEditing(true)}>Redo the interview</button>{" "}
              <button type="button" className="link" onClick={() => {
                if (window.confirm("Delete your interview answers and your path?")) void call("DELETE", "/api/v1/learn/interview").then(() => load());
              }}>Delete my answers</button>
            </p>
          ) : (
            <p>You skipped the interview. <button type="button" onClick={() => setEditing(true)}>Take the interview</button></p>
          )}
          {!path.plan && <p className="notice">Choose a plan or start the free trial (Account → Billing) to get a path.</p>}
          {path.aiNotice && <p className="ui-ai-notice" role="note">{path.aiNotice}</p>}
          {path.note && !path.aiNotice && <p className="small muted">{path.note}</p>}
          {path.note && path.aiNotice && path.note !== path.aiNotice && <p className="small muted">{path.note.replace(path.aiNotice, "").trim()}</p>}
          {path.plan === "basic" && <p className="small muted">Your plan&apos;s path covers one subject. Pro adds more subjects.</p>}
          <ol aria-label="Your path" className="ui-path">
            {path.courses.map((c, i) => (
              <li key={c.slug}>
                <strong>{c.firstLessonId ? <Link href={`/learn/${c.firstLessonId}`}>{c.name}</Link> : c.name}</strong>
                <div className="small">Why: {c.why}</div>
                <div className="small muted">About {Math.round(c.minutes / 60 * 10) / 10} hours (<CountUp value={c.lessons} /> lesson{c.lessons === 1 ? "" : "s"}): about <CountUp value={c.weeks} /> week{c.weeks === 1 ? "" : "s"} at your pace · last verified {c.lastVerifiedOn ?? "unknown"}</div>
                <div className="small ui-path__actions">
                  <button type="button" className="link" disabled={busy || i === 0} aria-label={`Move up: ${c.name}`}
                    onClick={() => { const o = path.courses.map((x) => x.slug); [o[i - 1], o[i]] = [o[i], o[i - 1]]; void change("PATCH", "/api/v1/learn/path", { order: o }); }}>Move up</button>{" · "}
                  <button type="button" className="link" disabled={busy || i === path.courses.length - 1} aria-label={`Move down: ${c.name}`}
                    onClick={() => { const o = path.courses.map((x) => x.slug); [o[i + 1], o[i]] = [o[i], o[i + 1]]; void change("PATCH", "/api/v1/learn/path", { order: o }); }}>Move down</button>{" · "}
                  <button type="button" className="link" disabled={busy} onClick={() => void change("DELETE", `/api/v1/learn/path/courses/${encodeURIComponent(c.slug)}`)}>Remove</button>
                </div>
              </li>
            ))}
          </ol>
          {path.courses.length === 0 && path.plan && <p className="muted ui-empty ui-empty--inline">No published course on your path. Redo the interview, or add one below.</p>}
          {path.canAdd && path.addable.length > 0 && <AddCourse path={path} busy={busy} onAdd={(slug) => void change("POST", "/api/v1/learn/path/courses", { slug })} />}
          <p className="small ui-block ui-block--slim">
            Practice items: {path.activityMode === "personal" ? "picked for your answers (each lesson says why)" : "the default set (every reviewed item)"}.{" "}
            <button type="button" className="link" disabled={busy} onClick={() => void call("PUT", "/api/v1/learn/path/activities", { mode: path.activityMode === "personal" ? "default" : "personal" }).then(() => load())}>
              {path.activityMode === "personal" ? "Use the default set" : "Pick them for my answers"}
            </button>
          </p>
        </>
      )}
      <RequestTopic levels={info.options.levels} />
    </>
  );
}

function AddCourse({ path, busy, onAdd }: { path: PathView; busy: boolean; onAdd: (slug: string) => void }) {
  const [slug, setSlug] = useState("");
  return (
    <p>
      <label>Add a published course{" "}
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">Choose…</option>
          {path.addable.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </label>{" "}
      <button type="button" disabled={busy || !slug} onClick={() => onAdd(slug)}>Add</button>
    </p>
  );
}

function Interview({ info, onDone, onCancel }: { info: InterviewInfo; onDone: (message: string | null, path: PathView | null) => void; onCancel: (() => void) | null }) {
  const a = info.answers;
  const [goal, setGoal] = useState(a?.goal ?? "");
  const [level, setLevel] = useState(a?.level ?? "");
  const [minutes, setMinutes] = useState<number>(a?.minutesPerWeek ?? 0);
  const [topics, setTopics] = useState<string[]>(a?.topics ?? []);
  const [interests, setInterests] = useState<string[]>(a?.interests ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const toggle = (list: string[], v: string, set: (l: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call("PUT", "/api/v1/learn/interview", { goal, level, minutesPerWeek: minutes, topics, interests });
    setBusy(false);
    const saved = r._status === 200 ? interviewSavedFrom(r) : null;
    if (!saved) return setMessage(r.reason ?? "Your answers weren't saved.");
    onDone(saved.reason ?? "Your path is ready.", saved.path);
  }
  async function skip() {
    const r = await call("POST", "/api/v1/learn/interview/skip", {});
    onDone(r._status === 200 ? "Skipped. You can take the interview any time from this page." : r.reason ?? null, null);
  }
  return (
    <form onSubmit={submit} aria-label="Interview" className="ui-form ui-block">
      <p className="small muted">Four quick questions about your learning: no personal details. Your answers are private to you and in your Privacy Center download.</p>
      {message && <p role="status">{message}</p>}
      <fieldset><legend>1. What do you want from this?</legend>
        <div className="ui-pills">{info.options.goals.map((g) => <p key={g.key}><label className="ui-pill"><input type="radio" name="goal" checked={goal === g.key} onChange={() => setGoal(g.key)} /> {g.label}</label></p>)}</div>
      </fieldset>
      <fieldset><legend>2. Where are you now?</legend>
        <div className="ui-pills">{info.options.levels.map((l) => <p key={l.key}><label className="ui-pill"><input type="radio" name="level" checked={level === l.key} onChange={() => setLevel(l.key)} /> {l.label}</label></p>)}</div>
      </fieldset>
      <fieldset><legend>3. Time each week</legend>
        <div className="ui-pills">{info.options.minutes.map((m) => <label key={m} className="ui-pill"><input type="radio" name="minutes" checked={minutes === m} onChange={() => setMinutes(m)} /> {m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} min`}</label>)}</div>
      </fieldset>
      <fieldset><legend>4. Topics and interests (optional)</legend>
        <div className="ui-pills">{info.options.topics.map((t) => <label key={t.slug} className="ui-pill"><input type="checkbox" checked={topics.includes(t.slug)} onChange={() => toggle(topics, t.slug, setTopics)} /> {t.name}{t.hasCourse ? "" : " (no course yet)"}</label>)}</div>
        <p className="small muted">Interests:</p>
        <div className="ui-pills">{info.options.interests.map((t) => <label key={t} className="ui-pill"><input type="checkbox" checked={interests.includes(t)} onChange={() => toggle(interests, t, setInterests)} /> {t.replace(/-/g, " ")}</label>)}</div>
      </fieldset>
      <p className="ui-actions">
        <button type="submit" className="primary" disabled={busy || !goal || !level || !minutes}>{a ? "Save and rebuild my path" : "Build my path"}</button>{" "}
        {!a && <button type="button" disabled={busy} onClick={() => void skip()}>Skip for now</button>}
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </p>
    </form>
  );
}

function RequestTopic({ levels }: { levels: { key: string; label: string }[] }) {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("beginner");
  const [message, setMessage] = useState<string | null>(null);
  async function send(e: FormEvent) {
    e.preventDefault();
    const r = await call("POST", "/api/v1/learn/course-requests", { topic, level });
    const res = r._status < 300 ? courseRequestFrom(r) : null;
    setMessage(res ? res.message : r.reason ?? "The request wasn't sent.");
    if (res?.recorded) setTopic("");
  }
  return (
    <form onSubmit={send} aria-label="Ask for a course" className="ui-block ui-form">
      <h2>Can&apos;t find a topic?</h2>
      <p className="small muted">Only the topic and level are sent, without your name. Courses are written and reviewed by people before anyone sees them.</p>
      <p className="ui-actions">
        <label>Topic <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} size={30} /></label>{" "}
        <label>Level <select value={level} onChange={(e) => setLevel(e.target.value)}>{levels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>{" "}
        <button type="submit" disabled={topic.trim().length < 3}>Ask for it</button>
      </p>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
