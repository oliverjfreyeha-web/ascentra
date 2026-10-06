"use client";

import { useState } from "react";
import { call } from "../../call";
import { attemptFrom, feedbackFrom, type AttemptResult, type LearnerActivity } from "../../activities-api";

type Strs = string[];
const list = (v: unknown): Strs => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * L6: practice items inside a lesson. Graded items (code-graded against an approved answer key) are graded at once and
 * show the correct answer with a cited explanation; only they count toward the lesson's score. Everything else is
 * "Practice, not graded": the learner can see a sample or key points after trying, and ask for AI feedback (counted
 * against their Mentor allowance; never a grade). Native form controls, labels and a live region for results.
 */
export function Practice({ items, score, onScore }: { items: LearnerActivity[]; score: { graded: number; correct: number }; onScore: (s: { graded: number; correct: number }) => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="practice-h">
      <h2 id="practice-h">Practice</h2>
      {score.graded > 0 && <p className="small">Graded items right: {score.correct} of {score.graded}. Only graded items count toward your progress.</p>}
      {items.map((a) => <ItemView key={a.id} item={a} onScore={onScore} />)}
    </section>
  );
}

function ItemView({ item: a, onScore }: { item: LearnerActivity; onScore: (s: { graded: number; correct: number }) => void }) {
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

  return (
    <fieldset className="notice">
      <legend><strong>{a.typeLabel}</strong> · {a.graded ? "Graded" : a.label} · {a.level}</legend>
      <p id={`${name}-prompt`}>{a.prompt}</p>
      {/* Graded types */}
      {(a.type === "multiple_choice") && options.map((o, i) => (
        <p key={i}><label><input type="radio" name={name} checked={answer.choice === i} onChange={() => setAnswer({ choice: i })} /> {o}</label></p>
      ))}
      {a.type === "true_false" && [true, false].map((v) => (
        <label key={String(v)} style={{ marginRight: "1em" }}><input type="radio" name={name} checked={answer.value === v} onChange={() => setAnswer({ value: v })} /> {v ? "True" : "False"}</label>
      ))}
      {a.type === "matching" && list(a.content.left).map((l, i) => (
        <p key={i}><label>{l}{" "}
          <select value={String((answer.pairs as number[] | undefined)?.[i] ?? "")} onChange={(e) => {
            const pairs = [...((answer.pairs as number[] | undefined) ?? list(a.content.left).map(() => -1))];
            pairs[i] = Number(e.target.value);
            setAnswer({ pairs });
          }}>
            <option value="">Choose…</option>
            {list(a.content.right).map((r, j) => <option key={j} value={j}>{r}</option>)}
          </select></label></p>
      ))}
      {a.type === "ordering" && list(a.content.steps).map((_, pos) => (
        <p key={pos}><label>Step {pos + 1}{" "}
          <select value={String((answer.order as number[] | undefined)?.[pos] ?? "")} onChange={(e) => {
            const order = [...((answer.order as number[] | undefined) ?? list(a.content.steps).map(() => -1))];
            order[pos] = Number(e.target.value);
            setAnswer({ order });
          }}>
            <option value="">Choose…</option>
            {list(a.content.steps).map((s, j) => <option key={j} value={j}>{s}</option>)}
          </select></label></p>
      ))}
      {a.type === "flashcard" && <p><strong>{String(a.content.front ?? "")}</strong> <span className="muted small">Think of the answer, then say whether you knew it.</span></p>}
      {/* Practice types: what's shown before trying */}
      {!a.graded && list(a.content.checklist).length > 0 && <ul>{list(a.content.checklist).map((c, i) => <li key={i}>{c}</li>)}</ul>}
      {!a.graded && a.type === "branching_scenario" && <ul>{options.map((o, i) => <li key={i}>{o}</li>)}</ul>}
      {!a.graded && typeof a.content.passage === "string" && <blockquote>{a.content.passage}</blockquote>}
      {!a.graded && typeof a.content.caseText === "string" && <><blockquote>{a.content.caseText}</blockquote><ul>{list(a.content.questions).map((q, i) => <li key={i}>{q}</li>)}</ul></>}

      {a.graded ? (
        a.type === "flashcard" ? (
          <p>
            <button type="button" disabled={busy || !!result} onClick={() => void submit({ answer: { knew: true } })}>I knew it</button>{" "}
            <button type="button" disabled={busy || !!result} onClick={() => void submit({ answer: { knew: false } })}>I didn&apos;t know it</button>
          </p>
        ) : (
          <p><button type="button" disabled={busy || !Object.keys(answer).length} onClick={() => void submit({ answer })}>Check my answer</button></p>
        )
      ) : (
        <>
          <p><label>Your answer (practice; not saved){" "}<textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} cols={60} aria-describedby={`${name}-prompt`} /></label></p>
          <p>
            <button type="button" disabled={busy} onClick={() => void submit({})}>Show the sample</button>{" "}
            <button type="button" disabled={busy || text.trim().length < 3} onClick={() => void getFeedback()}>Get feedback (AI)</button>{" "}
            <span className="small muted">AI feedback uses your Mentor allowance. It&apos;s never a grade.</span>
          </p>
        </>
      )}
      <div aria-live="polite">
        {message && <p role="status">{message}</p>}
        {result?.graded && (
          <div>
            <p><strong>{a.type === "flashcard" ? (result.correct ? "You knew it." : "Not yet: review it again.") : result.correct ? "Correct." : "Not quite."}</strong>{" "}
              {a.type === "flashcard" ? `Back: ${String(result.correctAnswer)}` : `Correct answer: ${correctText(result)}`}</p>
            <p>{result.explanation} <span className="small muted">Source: {result.citation.url ? <a href={result.citation.url} target="_blank" rel="noreferrer noopener">{result.citation.title}</a> : result.citation.title}</span></p>
          </div>
        )}
        {result && !result.graded && (
          <div>
            <p className="small"><strong>{result.label}.</strong></p>
            {Object.entries(result.reveal).map(([k, v]) => <p key={k} className="small">{k === "sampleAnswer" ? "Sample answer" : k === "keyPoints" ? "Key points" : k === "mistake" ? "The mistake" : k === "options" ? "Outcomes" : k}:{" "}
              {Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : `${(x as { text: string }).text}: ${(x as { outcome: string }).outcome} (${(x as { fit: string }).fit})`)).join("; ") : String(v)}</p>)}
            <p className="small">{result.explanation} <span className="muted">Source: {result.citation.title}</span></p>
          </div>
        )}
        {feedback && (
          <div className="notice">
            <p className="small"><strong>{feedback.label}</strong></p>
            <p>{feedback.feedback}</p>
            {feedback.note && <p className="small muted">{feedback.note}</p>}
          </div>
        )}
      </div>
    </fieldset>
  );
}
