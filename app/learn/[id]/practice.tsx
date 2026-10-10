"use client";

import { useState } from "react";
import { call } from "../../call";
import { attemptFrom, feedbackFrom, type AttemptResult, type LearnerActivity, type Selection } from "../../activities-api";
import { activityModeFrom } from "../../path-api";
import { ActivityIcon } from "../../ui/activity-icon";
import type { LessonProgress } from "../../progress-api";
import "../c2.css";

type Strs = string[];
const list = (v: unknown): Strs => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * L6: practice items inside a lesson. Graded items (code-graded against an approved answer key) are graded at once and
 * show the correct answer with a cited explanation; only they count toward the lesson's score. Everything else is
 * "Practice, not graded": the learner can see a sample or key points after trying, and ask for AI feedback (counted
 * against their Mentor allowance; never a grade). Native form controls, labels and a live region for results.
 * C2: in a course with the unlock rules, each item shows its importance label and whether it's done; a quiz counts as
 * done at 80% or more; other practice is marked done after trying it; an item not open yet says why. A real-world
 * mission shows its kind, and for a teen the limits and the Guardian requests.
 */
export function Practice({ items, score, selection, onScore, onModeChanged, progress, onProgress }: {
  items: LearnerActivity[]; score: { graded: number; correct: number }; selection: Selection;
  onScore: (s: { graded: number; correct: number }) => void; onModeChanged: () => void;
  progress?: LessonProgress | null; onProgress?: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  if (!items.length) return null;
  // L7: practice picked for the learner's interview answers, or the default set (every reviewed item).
  async function switchTo(mode: "personal" | "default") {
    const r = await call("PUT", "/api/v1/learn/path/activities", { mode });
    const m = r._status === 200 ? activityModeFrom(r) : null;
    setMessage(m ? null : r.reason ?? "Couldn't switch.");
    if (m) onModeChanged();
  }
  return (
    <section aria-labelledby="practice-h" className="ui-practice-section">
      <h2 id="practice-h">Practice</h2>
      {selection.note && <p className="small muted">{selection.note}</p>}
      {selection.personalized && <p><button type="button" className="link" onClick={() => void switchTo("default")}>Show the default set</button></p>}
      {selection.mode === "default" && selection.canPersonalize && <p><button type="button" className="link" onClick={() => void switchTo("personal")}>Pick practice for my answers again</button></p>}
      {message && <p role="status">{message}</p>}
      {progress && <p className="small muted">A quiz counts as done at 80% or more. Other practice counts once you try it and mark it done.</p>}
      {score.graded > 0 && <p className="small ui-act-score">Graded items right: {score.correct} of {score.graded}. Only graded items count toward your progress.</p>}
      {items.map((a) => <ItemView key={a.id} item={a} onScore={onScore} progress={progress ?? null} onProgress={onProgress} />)}
    </section>
  );
}

function ItemView({ item: a, onScore, progress, onProgress }: {
  item: LearnerActivity; onScore: (s: { graded: number; correct: number }) => void; progress: LessonProgress | null; onProgress?: () => void;
}) {
  const x = progress?.items.find((i) => i.kind === "activity" && i.id === a.id) ?? null;
  const locked = !!x && !x.open;
  const [answer, setAnswer] = useState<Record<string, unknown>>({});
  const [text, setText] = useState("");
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [feedback, setFeedback] = useState<{ label: string; feedback: string; note?: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = `item-${a.id}`;
  const options = list(a.content.options).length ? list(a.content.options) : Array.isArray(a.content.options) ? (a.content.options as { text: string }[]).map((o) => o.text) : [];

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    const r = await call("POST", `/api/v1/learn/activities/${a.id}/attempt`, body);
    setBusy(false);
    const res = r._status === 200 ? attemptFrom(r) : null;
    if (!res) return setMessage(r.reason ?? "Couldn't check that. Try again.");
    setMessage(null);
    setResult(res);
    if (res.graded) onScore(res.score);
    // C2: a quiz at 80% or more is done; the server decides, the page reloads the states.
    if (x && res.graded) onProgress?.();
  }
  async function markDone() {
    setBusy(true);
    const r = await call("POST", `/api/v1/learn/activities/${a.id}/complete`, {});
    setBusy(false);
    setMessage(r._status === 200 ? "Marked as done." : r.reason ?? "Couldn't mark it done.");
    if (r._status === 200) onProgress?.();
  }
  async function askGuardian(scope: "course" | "contact") {
    setBusy(true);
    const r = await call("POST", "/api/v1/learn/missions/request", { itemId: a.id, scope });
    setBusy(false);
    setMessage(r._status === 201 ? "Asked. Your Guardian sees the request in their Guardian Center." : r.reason ?? "Couldn't send the request.");
  }
  async function getFeedback() {
    setBusy(true);
    const r = await call("POST", `/api/v1/learn/activities/${a.id}/feedback`, { answer: text });
    setBusy(false);
    const f = r._status === 200 ? feedbackFrom(r) : null;
    setFeedback(f);
    setMessage(f ? null : r.reason ?? "AI feedback isn't available just now.");
  }
  const correctText = (r: Extract<AttemptResult, { graded: true }>) => {
    const k = r.correctAnswer;
    if (a.type === "multiple_choice") return options[k as number] ?? "";
    if (a.type === "true_false") return k ? "True" : "False";
    if (a.type === "matching") return list(a.content.left).map((l, i) => `${l} → ${list(a.content.right)[(k as number[])[i]]}`).join("; ");
    if (a.type === "ordering") return (k as number[]).map((i, n) => `${n + 1}. ${list(a.content.steps)[i]}`).join(" ");
    return String(k);
  };

  // D3: each type has its own layout, and graded items look different from "Practice, not graded" ones (a solid
  // Frozen frame and a Graded chip, or a dashed slate frame and the practice chip). The words are unchanged.
  const outcome = result?.graded ? (result.correct ? "correct" : "incorrect") : result ? "practice" : undefined;
  return (
    <fieldset className="ui-practice ui-act" data-type={a.type} data-graded={a.graded ? "true" : "false"} data-outcome={outcome}>
      <legend>
        <span className="ui-act__kind"><ActivityIcon type={a.type} /><strong>{a.typeLabel}</strong></span>
        <span className="ui-act__sep"> · </span>
        <span className="ui-act__grade">{a.graded ? "Graded" : a.label}</span>
        <span className="ui-act__sep"> · </span>
        <span className="ui-act__level">{a.level}</span>
        {x?.importanceLabel && <><span className="ui-act__sep"> · </span><span className="ui-badge">{x.importanceLabel}</span></>}
        {x?.done && <><span className="ui-act__sep"> · </span><span className="ui-badge ui-badge--accent">Done</span></>}
      </legend>
      {locked && <p className="small muted">Not open yet. {progress?.module.reason ?? ""}</p>}
      {x?.mission && (
        <div className="small">
          <p><strong>Real-world mission:</strong> {x.mission.label}.</p>
          {progress?.teen && (
            <>
              <ul>{(progress.missionLimits ?? []).map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="ui-actions">
                <button type="button" className="ui-btn ui-btn--quiet" disabled={busy} onClick={() => void askGuardian("course")}>Ask my Guardian to approve missions in this course</button>
                {x.mission.contacts && <> <button type="button" className="ui-btn ui-btn--quiet" disabled={busy} onClick={() => void askGuardian("contact")}>Ask my Guardian to approve this mission</button></>}
              </p>
            </>
          )}
        </div>
      )}
      {a.why && <p className="small muted">Why this one: {a.why.join("; ")}.</p>}
      <p id={`${name}-prompt`} className="ui-act__prompt">{a.prompt}</p>
      {/* Graded types */}
      {(a.type === "multiple_choice") && (
        <div className="ui-act__options">{options.map((o, i) => (
          <label key={i} className="ui-choice ui-act__option"><input type="radio" name={name} checked={answer.choice === i} onChange={() => setAnswer({ choice: i })} /> <span>{o}</span></label>
        ))}</div>
      )}
      {a.type === "true_false" && (
        <div className="ui-act__tf">{[true, false].map((v) => (
          <label key={String(v)} className="ui-pill ui-act__tf-option"><input type="radio" name={name} checked={answer.value === v} onChange={() => setAnswer({ value: v })} /> {v ? "True" : "False"}</label>
        ))}</div>
      )}
      {a.type === "matching" && (
        <div className="ui-act__pairs">{list(a.content.left).map((l, i) => (
          <label key={i} className="ui-act__pair"><span className="ui-act__term">{l}</span>{" "}
            <span className="ui-act__arrow" aria-hidden="true">→</span>
            <select className="ui-select" value={String((answer.pairs as number[] | undefined)?.[i] ?? "")} onChange={(e) => {
              const pairs = [...((answer.pairs as number[] | undefined) ?? list(a.content.left).map(() => -1))];
              pairs[i] = Number(e.target.value);
              setAnswer({ pairs });
            }}>
              <option value="">Choose…</option>
              {list(a.content.right).map((r, j) => <option key={j} value={j}>{r}</option>)}
            </select></label>
        ))}</div>
      )}
      {a.type === "ordering" && (
        <ol className="ui-act__steps">{list(a.content.steps).map((_, pos) => (
          <li key={pos}><label className="ui-act__pair"><span className="ui-act__step">Step {pos + 1}</span>{" "}
            <select className="ui-select" value={String((answer.order as number[] | undefined)?.[pos] ?? "")} onChange={(e) => {
              const order = [...((answer.order as number[] | undefined) ?? list(a.content.steps).map(() => -1))];
              order[pos] = Number(e.target.value);
              setAnswer({ order });
            }}>
              <option value="">Choose…</option>
              {list(a.content.steps).map((s, j) => <option key={j} value={j}>{s}</option>)}
            </select></label></li>
        ))}</ol>
      )}
      {a.type === "flashcard" && <p className="ui-act__card"><strong>{String(a.content.front ?? "")}</strong> <span className="muted small">Think of the answer, then say whether you knew it.</span></p>}
      {/* Practice types: what's shown before trying */}
      {!a.graded && list(a.content.checklist).length > 0 && <ul className="ui-act__checklist">{list(a.content.checklist).map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {!a.graded && a.type === "branching_scenario" && <ul className="ui-act__branches">{options.map((o, i) => <li key={i}>{o}</li>)}</ul>}
      {!a.graded && typeof a.content.passage === "string" && <blockquote className="ui-act__doc">{a.content.passage}</blockquote>}
      {!a.graded && typeof a.content.caseText === "string" && <><blockquote className="ui-act__doc">{a.content.caseText}</blockquote><ul className="ui-act__questions">{list(a.content.questions).map((q, i) => <li key={i}>{q}</li>)}</ul></>}

      {a.graded ? (
        a.type === "flashcard" ? (
          <p className="ui-actions">
            <button type="button" className="ui-btn" disabled={busy || locked || !!result} onClick={() => void submit({ answer: { knew: true } })}>I knew it</button>{" "}
            <button type="button" className="ui-btn" disabled={busy || locked || !!result} onClick={() => void submit({ answer: { knew: false } })}>I didn&apos;t know it</button>
          </p>
        ) : (
          <p className="ui-actions"><button type="button" className="ui-btn ui-btn--primary" disabled={busy || locked || !Object.keys(answer).length} onClick={() => void submit({ answer })}>Check my answer</button></p>
        )
      ) : (
        <>
          <p className="ui-act__answer"><label>Your answer (practice; not saved){" "}<textarea className="ui-input" value={text} onChange={(e) => setText(e.target.value)} rows={3} cols={60} aria-describedby={`${name}-prompt`} /></label></p>
          <p className="ui-actions">
            <button type="button" className="ui-btn" disabled={busy || locked} onClick={() => void submit({})}>Show the sample</button>{" "}
            {x && !x.done && (result || (a.result?.attempts ?? 0) > 0) && <><button type="button" className="ui-btn ui-btn--primary" disabled={busy || locked} onClick={() => void markDone()}>Mark as done</button>{" "}</>}
            <button type="button" className="ui-btn ui-btn--quiet" disabled={busy || text.trim().length < 3} onClick={() => void getFeedback()}>Get feedback (AI)</button>{" "}
            <span className="small muted">AI feedback uses your Mentor allowance. It&apos;s never a grade.</span>
          </p>
        </>
      )}
      <div aria-live="polite">
        {message && <p role="status" className="ui-state ui-state--error">{message}</p>}
        {result?.graded && (
          <div className="ui-result" data-outcome={outcome}>
            <span className="ui-result__mark" aria-hidden="true" />
            <p><strong>{a.type === "flashcard" ? (result.correct ? "You knew it." : "Not yet: review it again.") : result.correct ? "Correct." : "Not quite."}</strong>{" "}
              {a.type === "flashcard" ? `Back: ${String(result.correctAnswer)}` : `Correct answer: ${correctText(result)}`}</p>
            <p>{result.explanation} <span className="small muted">Source: {result.citation.url ? <a href={result.citation.url} target="_blank" rel="noreferrer noopener">{result.citation.title}</a> : result.citation.title}</span></p>
          </div>
        )}
        {result && !result.graded && (
          <div className="ui-result" data-outcome="practice">
            <p className="small"><strong>{result.label}.</strong></p>
            {Object.entries(result.reveal).map(([k, v]) => <p key={k} className="small">{k === "sampleAnswer" ? "Sample answer" : k === "keyPoints" ? "Key points" : k === "mistake" ? "The mistake" : k === "options" ? "Outcomes" : k}:{" "}
              {Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : `${(x as { text: string }).text}: ${(x as { outcome: string }).outcome} (${(x as { fit: string }).fit})`)).join("; ") : String(v)}</p>)}
            <p className="small">{result.explanation} <span className="muted">Source: {result.citation.title}</span></p>
          </div>
        )}
        {feedback && (
          <div className="ui-result" data-outcome="feedback">
            <p className="small"><strong>{feedback.label}</strong></p>
            <p>{feedback.feedback}</p>
            {feedback.note && <p className="small muted">{feedback.note}</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}
