"use client";

import { useEffect, useState, type FormEvent } from "react";
import { call, when } from "../../call";
import { notebookFrom, notebookText, summaryFrom, type Notebook } from "../../progress-api";
import { Loading } from "../../ui/loading";
import "../c2.css";

/**
 * C2: the learner's private Notebook. Auto-notes (from "Very important" items they finish), by category; "My ideas",
 * their own journal; optional AI summaries of the auto-notes (off until turned on; a few a day; never the journal);
 * and "Copy as text".
 */
export function NotebookView() {
  const [n, setN] = useState<Notebook | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; label: string } | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/learn/notebook").then((r) => {
      const v = r._status === 200 ? notebookFrom(r) : null;
      setN(v);
      setFailed(v ? null : r.reason ?? "Couldn't load your Notebook.");
    });
  }, []);
  async function send(method: string, url: string, body: unknown, done: string) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const v = r._status < 300 ? notebookFrom(r) : null;
    if (v) setN(v);
    setMessage(v ? done : r.reason ?? "Nothing was changed.");
    return !!v;
  }
  async function summarize() {
    setBusy(true);
    const r = await call("POST", "/api/v1/learn/notebook/summary", {});
    setBusy(false);
    const s = r._status === 200 ? summaryFrom(r) : null;
    setSummary(s);
    setMessage(s ? "Summary ready." : r.reason ?? "No summary this time.");
  }
  async function copy() {
    if (!n) return;
    try { await navigator.clipboard.writeText(notebookText(n)); setMessage("Copied your Notebook as text."); }
    catch { setMessage("Couldn't copy here. Select the text below instead."); }
  }
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!n) return <Loading shape="list" />;
  const total = n.categories.reduce((s, c) => s + c.entries.length, 0);
  return (
    <>
      <p className="c2-notice" role="note">{n.note}</p>
      {message && <p role="status">{message}</p>}
      <p className="ui-actions"><button type="button" onClick={() => void copy()}>Copy as text</button></p>

      <section className="ui-block" aria-labelledby="auto-h">
        <h2 id="auto-h">Auto-notes</h2>
        {!total && <p className="muted small">Nothing yet. Finish a &ldquo;Very important&rdquo; item and its key note appears here.</p>}
        {n.categories.filter((c) => c.entries.length).map((c) => (
          <section key={c.key} aria-labelledby={`nb-${c.key}`}>
            <h3 id={`nb-${c.key}`}>{c.label}</h3>
            <ul className="c2-entries">
              {c.entries.map((e) => (
                <li key={e.id}>
                  <strong>{e.title}</strong> <span className="ui-badge">{e.importanceLabel}</span>
                  <p className="small muted">{e.course} · {when(e.at)}</p>
                  <p>{e.note}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>

      <section className="ui-block" aria-labelledby="ai-h">
        <h2 id="ai-h">AI summary (optional)</h2>
        <p className="small muted">
          Off unless you turn it on. Only your auto-notes are sent (never &ldquo;My ideas&rdquo;, never your name). Up to {n.ai.dailyLimit} a day.
          {!n.ai.available && " AI isn't available right now."}
        </p>
        <label><input type="checkbox" checked={n.ai.on} disabled={busy} onChange={(e) => void send("PUT", "/api/v1/learn/notebook/ai", { on: e.target.checked }, e.target.checked ? "AI summaries are on." : "AI summaries are off.")} /> Use AI summaries</label>
        {n.ai.on && <p className="ui-actions"><button type="button" disabled={busy || !total || !n.ai.available} onClick={() => void summarize()}>Summarize my auto-notes</button></p>}
        {summary && <div aria-labelledby="sum-h"><h3 id="sum-h">{summary.label}</h3><p className="c2-summary">{summary.summary}</p></div>}
      </section>

      <section className="ui-block" aria-labelledby="ideas-h">
        <h2 id="ideas-h">My ideas</h2>
        <p className="small muted">Your own journal. Private to you, kept apart from the auto-notes.</p>
        <NewIdea busy={busy} onAdd={(body) => send("POST", "/api/v1/learn/notebook/ideas", { body }, "Idea saved.")} />
        <ul className="c2-entries">
          {n.ideas.map((i) => (
            <Idea key={i.id} idea={i} busy={busy}
              onSave={(body) => send("PATCH", `/api/v1/learn/notebook/ideas/${i.id}`, { body }, "Idea saved.")}
              onDelete={() => send("DELETE", `/api/v1/learn/notebook/ideas/${i.id}`, undefined, "Idea deleted.")} />
          ))}
        </ul>
      </section>
    </>
  );
}

function NewIdea({ busy, onAdd }: { busy: boolean; onAdd: (body: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onAdd(text)) setText("");
  }
  return (
    <form onSubmit={submit} className="ui-form" aria-label="New idea">
      <label>New idea <textarea rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <p className="ui-actions"><button type="submit" disabled={busy || !text.trim()}>Save idea</button></p>
    </form>
  );
}

function Idea({ idea, busy, onSave, onDelete }: { idea: Notebook["ideas"][number]; busy: boolean; onSave: (body: string) => Promise<boolean>; onDelete: () => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(idea.body);
  if (!editing) return (
    <li>
      <p className="c2-summary">{idea.body}</p>
      <p className="small muted">{when(idea.updatedAt)}</p>
      <p className="ui-actions small">
        <button type="button" className="link" onClick={() => setEditing(true)}>Edit<span className="sr-only"> this idea</span></button>{" · "}
        <button type="button" className="link" disabled={busy} onClick={() => void onDelete()}>Delete<span className="sr-only"> this idea</span></button>
      </p>
    </li>
  );
  return (
    <li>
      <form className="ui-form" aria-label="Edit idea" onSubmit={(e) => { e.preventDefault(); void onSave(text).then((ok) => { if (ok) setEditing(false); }); }}>
        <label>Idea <textarea rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <p className="ui-actions"><button type="submit" disabled={busy || !text.trim()}>Save</button> <button type="button" onClick={() => setEditing(false)}>Cancel</button></p>
      </form>
    </li>
  );
}
