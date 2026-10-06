"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { call } from "../../call";
import { mentorReplyFrom, mentorThreadFrom, mentorThreadsFrom, type MentorInfo, type MentorMessage } from "../../mentor-api";

const KIND_NOTE: Partial<Record<NonNullable<MentorMessage["kind"]>, string>> = {
  not_in_sources: "Not in the course's sources",
  graded_refusal: "Won't do graded work",
  off_topic: "Outside this course",
  safety: "Safety response",
  paused: "Paused",
};

/**
 * L4: the Mentor on a lesson. The AI notice is shown in context, above the conversation and on every reply. Answers
 * come from the course's approved sources with citations, or say the sources don't cover it.
 */
export function MentorPanel({ lessonId }: { lessonId: string }) {
  const [info, setInfo] = useState<MentorInfo | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [status, setStatus] = useState("open");
  const [messages, setMessages] = useState<MentorMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // L5: the Mentor paused because the allowance is used up (or there isn't one): 402 from the API.
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    const r = await call("GET", `/api/v1/mentor/threads?lessonId=${encodeURIComponent(lessonId)}`);
    const list = r._status === 200 ? mentorThreadsFrom(r) : null;
    if (!list) return setError(r.reason ?? "The Mentor couldn't load.");
    setInfo(list.mentor);
    const latest = list.threads[0];
    if (!latest) return;
    const t = mentorThreadFrom(await call("GET", `/api/v1/mentor/threads/${latest.id}`));
    if (t) { setThreadId(t.id); setStatus(t.status); setMessages(t.messages); }
  }, [lessonId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const r = await call("POST", "/api/v1/mentor", { lessonId, message: text, ...(threadId && status === "open" ? { threadId } : {}) });
    setBusy(false);
    setPaused(r._status === 402);
    if (r._status === 402) void load();
    const reply = r._status === 200 ? mentorReplyFrom(r) : null;
    if (!reply) return setError(r.reason ?? "The Mentor couldn't answer just now.");
    setInfo(reply.mentor);
    if (reply.reply.kind === "paused") return setError(reply.reply.text);
    if (reply.thread.id !== threadId) { setThreadId(reply.thread.id); setMessages([]); }
    setStatus(reply.thread.status);
    setMessages((m) => [...(reply.thread.id !== threadId ? [] : m), { role: "learner", text: reply.reply.note ? "(personal details removed)" : text, at: new Date().toISOString() }, reply.reply]);
    setText("");
  }

  async function remove() {
    if (!threadId || !window.confirm("Delete this conversation? This can't be undone.")) return;
    await call("DELETE", `/api/v1/mentor/threads/${threadId}`);
    setThreadId(null); setMessages([]); setStatus("open");
  }

  return (
    <section aria-labelledby="mentor-h" className="ui-block ui-mentor">
      <h2 id="mentor-h">Mentor</h2>
      <p className="ui-ai-notice" role="note">
        <strong>AI notice:</strong> the Mentor is an AI (Claude). It answers only from this course&apos;s approved sources and cites them; it can
        still be wrong, so check the source. It won&apos;t do graded work, but it will explain and give hints. Don&apos;t share personal details.
        Your conversations are private to you (Support never sees them) and are not used to train AI models.
      </p>
      {info && !info.aiOn && <p>The Mentor is off right now (AI isn&apos;t set up). Your lessons work as usual.</p>}
      {messages.length > 0 && <div className="ui-chat">{messages.map((m, i) => (
        <div key={i} className={m.role === "mentor" ? "ui-msg ui-msg--mentor" : "ui-msg ui-msg--you"}>
          <p className="small muted">{m.role === "learner" ? "You" : `Mentor · AI-generated${m.kind && KIND_NOTE[m.kind] ? ` · ${KIND_NOTE[m.kind]}` : ""}`}</p>
          <p>{m.text}{m.citations?.length ? <sup> {m.citations.map((c) => `[${c.ref}]`).join("")}</sup> : null}</p>
          {m.citations?.length ? (
            <ol className="small">
              {m.citations.map((c) => <li key={c.ref}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a> : c.title}</li>)}
            </ol>
          ) : null}
          {m.note && <p className="small muted">{m.note}</p>}
        </div>
      ))}</div>}
      {status === "paused" && <p className="muted small">This conversation is paused. Start a new one to keep going with your lesson.</p>}
      {info?.allowance.line && (
        <p className="small ui-meter-line" aria-label="Mentor allowance meter">
          <meter min={0} max={info.allowance.usableUsd || 1} value={Math.min(info.allowance.usedUsd, info.allowance.usableUsd)} />{" "}
          {info.allowance.line}{info.allowance.trial ? " (free trial allowance)" : ""}
        </p>
      )}
      {error && <p role="status">{error}</p>}
      {(paused || info?.allowance.status === "used_up" || info?.allowance.status === "none") && (
        <p className="small">
          {info?.allowance.canChange
            ? <Link href="/account#mentor-allowance">{info.allowance.status === "none" ? "Add a Mentor allowance" : "Raise my Mentor allowance"}</Link>
            : "Only your Guardian can add or raise your Mentor allowance."}
        </p>
      )}
      {info?.aiOn && (
        <form onSubmit={ask}>
          <p className="ui-composer">
            <label>Ask about this lesson <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} size={60} /></label>{" "}
            <button type="submit" className="primary" disabled={busy || !text.trim()}>{busy ? "Thinking…" : "Ask"}</button>
          </p>
          <p className="small muted">
            Up to {info.dailyCap} messages a day.{" "}
            {threadId && <><button type="button" className="link" onClick={() => { setThreadId(null); setMessages([]); setStatus("open"); }}>New conversation</button> · <button type="button" className="link" onClick={() => void remove()}>Delete this conversation</button></>}
          </p>
        </form>
      )}
    </section>
  );
}
