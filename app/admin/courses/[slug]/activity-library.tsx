"use client";

import { useCallback, useEffect, useState } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, type ApiResult } from "../../../call";
import { meFrom } from "../../../me";
import {
  itemStatusFrom, libraryFrom, missesFrom, modulePublishedFrom, poolDraftedFrom, type Library, type LibraryItem, type MissItem,
} from "../../../activities-api";

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * L6: the course's activity library for Reviewers and builders: draft a lesson's practice pool with AI, review each item
 * (edit, approve, reject), see the diff after a refresh, counts by type and level, the variety rule per module, publish a
 * module's approved items, and the common misses (counts only, never who).
 */
export function ActivityLibrary({ slug }: { slug: string }) {
  const [role, setRole] = useState<string | null>(null);
  const [lib, setLib] = useState<Library | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, { prompt: string; explanation: string }>>({});
  const [misses, setMisses] = useState<Record<string, MissItem[]>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Publishing re-checks the second factor, like publishing a lesson.
  const verified = useReverification(call);
  // The library and its actions (not the course detail, which the course builder reads).
  const base = "/api/v1/courses/" + encodeURIComponent(slug);

  const load = useCallback(async () => {
    const r = await call("GET", `${base}/activities`);
    setLib(r._status === 200 ? libraryFrom(r) : null);
  }, [base]);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function act(run: () => Promise<ApiResult>, done: (r: ApiResult) => string | null, pending?: string) {
    setBusy(true);
    setMessage(pending ?? null);
    const r = await run();
    setBusy(false);
    setMessage(r._status < 300 ? done(r) ?? "Done." : r.reason ?? "Nothing was changed.");
    await load();
  }

  if (!lib) return null;
  const builds = role === "owner" || role === "superAdmin" || role === "courseAdmin";
  const reviews = role === "owner" || role === "reviewer";
  return (
    <section aria-labelledby="library-h">
      <h2 id="library-h">Practice items</h2>
      <p className="small muted">
        Graded by code (against the approved answer key): multiple choice, true or false, matching, ordering, flashcard self-check. Everything
        else is practice with feedback, never a grade. A module is published only with at least 3 different activity types.
      </p>
      {message && <p role="status">{message}</p>}
      {lib.modules.map((m) => (
        <div key={m.id} className="notice">
          <h3>{m.title}</h3>
          <p>
            {m.variety.types} activity type{m.variety.types === 1 ? "" : "s"} after publishing ({m.variety.approved} approved, waiting).{" "}
            {!m.variety.ok && <strong role="alert">Fewer than {m.variety.min} activity types: this module can&apos;t be published yet.</strong>}{" "}
            {builds && (
              <>
                <label>Reason (recorded) <input value={reasons[m.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [m.id]: e.target.value })} size={30} /></label>{" "}
              <button type="button" disabled={busy || !m.variety.ok || !m.variety.approved || (reasons[m.id] ?? "").trim().length < 5}
                onClick={() => void act(() => verified("POST", `${base}/modules/${m.id}/activities/publish`, { reason: reasons[m.id] }), (r) => {
                  const p = modulePublishedFrom(r);
                  return p ? `Published ${p.published} item(s); ${p.types} activity types live.` : null;
                })}>
                Publish approved items
              </button>
              </>
            )}
          </p>
          {m.lessons.map((l) => (
            <div key={l.id}>
              <h4>{l.title}</h4>
              <p className="small">
                {Object.entries(l.counts.byType).map(([t, n]) => `${t.replace(/_/g, " ")}: ${n}`).join(" · ") || "No items yet"}
                {" · "}beginner {l.counts.byLevel.beginner ?? 0} · intermediate {l.counts.byLevel.intermediate ?? 0}
              </p>
              <p>
                {builds && (
                  <button type="button" disabled={busy} onClick={() => void act(() => call("POST", `${base}/lessons/${l.id}/activities`, {}), (r) => {
                    const d = poolDraftedFrom(r);
                    return d ? `Drafted ${d.drafted} item(s) of ${d.types} types${d.dropped ? ` (${d.dropped} dropped)` : ""}. They're Drafts until reviewed.` : null;
                  }, "Drafting the practice pool… this can take a minute.")}>Draft a practice pool with AI</button>
                )}{" "}
                {reviews && (
                  <button type="button" className="link" onClick={() => void call("GET", `${base}/lessons/${l.id}/misses`).then((r) => {
                    const items = r._status === 200 ? missesFrom(r) : null;
                    if (items) setMisses({ ...misses, [l.id]: items });
                    else setMessage(r.reason ?? "Couldn't load the misses.");
                  })}>Common misses</button>
                )}
              </p>
              {misses[l.id] && (
                <ul className="small" aria-label={`Common misses in ${l.title}`}>
                  {misses[l.id].length === 0 ? <li>No graded attempts yet.</li> : misses[l.id].map((x) => (
                    <li key={x.id}>{x.typeLabel}: {x.prompt} · {x.correct} of {x.attempts} right{x.misses.length ? ` · most common wrong answers: ${x.misses.slice(0, 3).map((mm) => `${show(mm.answer)} (${mm.count})`).join(", ")}` : ""}</li>
                  ))}
                </ul>
              )}
              {l.items.map((i) => <ItemCard key={i.id} item={i} reviews={reviews} busy={busy} note={notes[i.id] ?? ""} setNote={(v) => setNotes({ ...notes, [i.id]: v })}
                edit={edits[i.id]} setEdit={(v) => setEdits({ ...edits, [i.id]: v! })}
                save={() => void act(() => call("PATCH", `${base}/activities/${i.id}`, edits[i.id]), (r) => (itemStatusFrom(r) ? "Saved the Draft." : null))}
                decide={(decision) => void act(() => call("POST", `${base}/activities/${i.id}/review`, { decision, note: notes[i.id] ?? "" }), (r) => {
                  const s = itemStatusFrom(r);
                  return s ? `Item ${s.status}.` : null;
                })} />)}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function ItemCard({ item: i, reviews, busy, note, setNote, edit, setEdit, save, decide }: {
  item: LibraryItem; reviews: boolean; busy: boolean; note: string; setNote: (v: string) => void;
  edit: { prompt: string; explanation: string } | undefined; setEdit: (v: { prompt: string; explanation: string } | undefined) => void;
  save: () => void; decide: (d: "approve" | "reject") => void;
}) {
  return (
    <div className="small" style={{ borderTop: "1px solid #ddd", paddingTop: "0.5em" }}>
      <p>
        <strong>{i.typeLabel}</strong> · {i.grading === "code" ? "graded by code" : "practice, not graded"} · {i.level} · {i.status}
        {i.replaces ? ` · would replace v${i.replaces.version} (${i.replaces.status})` : ""} · goal: {i.goal}{i.interests.length ? ` · interests: ${i.interests.join(", ")}` : ""}
      </p>
      {edit ? (
        <p>
          <label>Prompt <textarea value={edit.prompt} onChange={(e) => setEdit({ ...edit, prompt: e.target.value })} rows={2} cols={70} /></label><br />
          <label>Explanation <textarea value={edit.explanation} onChange={(e) => setEdit({ ...edit, explanation: e.target.value })} rows={2} cols={70} /></label><br />
          <button type="button" disabled={busy} onClick={save}>Save</button> <button type="button" onClick={() => setEdit(undefined)}>Cancel</button>
        </p>
      ) : (
        <>
          <p>{i.prompt}</p>
          {Object.entries(i.content).map(([k, v]) => <p key={k} className="muted">{k}: {show(v)}</p>)}
          {i.answerKey && <p>Answer key: {show(i.answerKey)}</p>}
          <p>Why: {i.explanation}</p>
        </>
      )}
      <p className="muted">Source: {i.citation.url ? <a href={i.citation.url} target="_blank" rel="noreferrer noopener">{i.citation.title}</a> : i.citation.title}{i.citation.quote ? ` · "${i.citation.quote}"` : ""}</p>
      {i.diff && (
        <details><summary>Changes against the published version</summary>
          <ul>{i.diff.filter((d) => d.op !== "same").map((d, n) => <li key={n}>{d.op === "add" ? "+ " : "− "}{d.text}</li>)}</ul>
        </details>
      )}
      {i.reviewNote && <p className="muted">Review note: {i.reviewNote}</p>}
      {reviews && i.status === "draft" && (
        <p>
          {!edit && <><button type="button" className="link" onClick={() => setEdit({ prompt: i.prompt, explanation: i.explanation })}>Edit</button>{" "}</>}
          <label>Review note (recorded) <input value={note} onChange={(e) => setNote(e.target.value)} size={40} /></label>{" "}
          <button type="button" disabled={busy || note.trim().length < 5} onClick={() => decide("approve")}>Approve</button>{" "}
          <button type="button" className="danger" disabled={busy || note.trim().length < 5} onClick={() => decide("reject")}>Reject</button>
        </p>
      )}
    </div>
  );
}
