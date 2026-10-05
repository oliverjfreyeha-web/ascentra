"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { call, when } from "../../call";
import { estimateFrom, researchResultFrom, researchRunsFrom, usd, type Estimate, type ResearchRun } from "../../courses-api";

const FRESHNESS = "What tools, terms and methods are current, and what has become outdated?";

/**
 * L2: "Research a topic", started from the Source library. Claude searches the web; what it finds is added here as
 * PROPOSED sources and claims (approve them in the list below before they can be used), with notes on what has been
 * replaced. The estimate is shown before the run.
 */
export function ResearchPanel({ canRun, onDone }: { canRun: boolean; onDone: () => void }) {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("beginner");
  const [freshness, setFreshness] = useState(FRESHNESS);
  const [runs, setRuns] = useState<ResearchRun[] | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([call("GET", "/api/v1/sources/research"), call("GET", "/api/v1/courses/estimate")]);
    setRuns(r._status === 200 ? researchRunsFrom(r) : null);
    setEstimate(e._status === 200 ? estimateFrom(e) : null);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("Researching… this can take a minute or two.");
    const r = await call("POST", "/api/v1/sources/research", { topic, audience, freshness });
    setBusy(false);
    const res = r._status === 201 ? researchResultFrom(r) : null;
    setMessage(res
      ? `Found ${res.sources} source(s) (${res.newSources} new, proposed), ${res.claims} claim(s)${res.uncited ? ` (${res.uncited} with no source, marked)` : ""} and ${res.outdated} outdated note(s), with ${res.searches} search(es) for ${usd(res.costUsd)}. Approve the sources below before they can be used.`
      : r.reason ?? "The research didn't run.");
    await load();
    onDone();
  }

  return (
    <section aria-labelledby="research-h">
      <h2 id="research-h">Research a topic</h2>
      <p className="muted">
        Claude searches the web for current sources. What it finds is added as <strong>proposed</strong>: nothing is usable until
        a Reviewer approves it. Only short quotes are kept.
      </p>
      {estimate && (
        <p className="muted small">
          {estimate.aiOn
            ? <>Estimated cost of one run: up to {usd(estimate.course.research)} (tokens and up to 5 searches). Left under the caps: {usd(estimate.left.day)} today, {usd(estimate.left.month)} this month.</>
            : <>AI is off: ANTHROPIC_API_KEY isn&apos;t set. Research is disabled; everything else works.</>}
        </p>
      )}
      {canRun && estimate?.aiOn && (
        <form onSubmit={run}>
          <p><label>Topic <input value={topic} onChange={(e) => setTopic(e.target.value)} required minLength={3} maxLength={200} /></label>{" "}
            <label>Audience{" "}
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
              </select>
            </label></p>
          <p><label>Freshness question <input value={freshness} onChange={(e) => setFreshness(e.target.value)} size={70} maxLength={500} /></label></p>
          <button type="submit" disabled={busy}>Research (up to {usd(estimate.course.research)})</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {runs && runs.length > 0 && (
        <details>
          <summary>Research runs ({runs.length})</summary>
          {runs.map((r) => (
            <div key={r.id} className="notice">
              <p><strong>{r.topic}</strong> · {r.audience} · {when(r.createdAt)} · {r.searches} search(es) · {usd(r.costUsd)}</p>
              <p className="muted small">Sources: {r.sources.map((s) => `${s.title} (${s.status}${s.pageAge ? `, dated ${s.pageAge}` : ""})`).join("; ") || "none"}</p>
              {r.outdated.length > 0 && (
                <>
                  <p>Outdated, according to these sources:</p>
                  <ul>
                    {r.outdated.map((n, i) => (
                      <li key={i}>
                        {n.item}{n.replacedBy ? <> → {n.replacedBy}</> : null}{n.note ? `: ${n.note}` : ""}{" "}
                        <span className="muted small">{n.sources.map((s) => s.title ?? s.url).join("; ") || "no source"}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
