import type { Citation, LessonBody, Para } from "./courses-api";

/**
 * L2: a lesson as learners (and reviewers, in preview) read it: inline citation numbers after each paragraph, a
 * "No source" mark where a paragraph has none, the sources with their license and when each was last checked, and
 * the lesson's "Last verified" date (the oldest of those).
 */
function Refs({ p }: { p: Para }) {
  if (!p.refs.length) return <> <span className="ui-nosource">[No source]</span></>;
  return (
    <sup>
      {p.refs.map((r, i) => (
        <span key={r}>{i ? ", " : " "}<a href={`#cite-${r}`} aria-label={`Source ${r}`}>[{r}]</a></span>
      ))}
    </sup>
  );
}

export function LessonView({ body, citations, lastVerifiedOn, uncited }: { body: LessonBody; citations: Citation[]; lastVerifiedOn: string | null; uncited: number }) {
  return (
    <article className="ui-prose">
      {body.summary && <p className="ui-summary">{body.summary}</p>}
      {body.sections.map((s, i) => (
        <section key={i}>
          <h3>{s.heading}</h3>
          {s.paragraphs.map((p, j) => <p key={j}>{p.text}<Refs p={p} /></p>)}
        </section>
      ))}
      {body.takeaways.length > 0 && (
        <div className="ui-takeaways">
          <h3>Key takeaways</h3>
          <ul>{body.takeaways.map((t, i) => <li key={i}>{t.text}<Refs p={t} /></li>)}</ul>
        </div>
      )}
      <div className="ui-sources">
      <h3>Sources</h3>
      <p className="muted small">
        Last verified: {lastVerifiedOn ?? "unknown"} (the oldest date any of its sources was last checked).
        {uncited ? ` ${uncited} passage(s) have no source and are marked.` : ""}
      </p>
      {citations.length === 0 ? <p className="muted">No sources cited.</p> : (
        <ol>
          {citations.map((c) => (
            <li key={c.ref} id={`cite-${c.ref}`}>
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener">{c.title}</a> : c.title}{" "}
              <span className="muted small">· {c.license === "web_summarize_only" ? "web source (summarized)" : c.license === "open" ? "open license" : c.license} · last checked {c.lastChecked ?? "unknown"}</span>
            </li>
          ))}
        </ol>
      )}
      </div>
    </article>
  );
}
