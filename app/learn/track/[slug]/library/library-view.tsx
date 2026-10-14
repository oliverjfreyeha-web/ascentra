"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { call } from "../../../../call";
import { libraryFrom, searchLibrary, type TrackLibrary } from "../../../../track-api";
import { Loading } from "../../../../ui/loading";
import "../../../c2.css";

/**
 * S1: a track's library. Every lesson the learner can open, by Round and section, read-only and searchable. Lessons in
 * sections that aren't open yet aren't sent by the server at all; locked Rounds are named with their reason.
 */
export function LibraryView({ slug, initial }: { slug: string; initial?: TrackLibrary | null }) {
  const [lib, setLib] = useState<TrackLibrary | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const searchId = useId();
  useEffect(() => {
    if (initial) return;
    void call("GET", `/api/v1/learn/tracks/${encodeURIComponent(slug)}/library`).then((r) => {
      const v = r._status === 200 ? libraryFrom(r) : null;
      setLib(v);
      setFailed(v ? null : r.reason ?? "Couldn't load the library.");
    });
  }, [slug, initial]);
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!lib) return <Loading shape="list" />;
  const shown = searchLibrary(lib.entries, query);
  const rounds = [...new Set(shown.map((e) => e.round))].sort();
  return (
    <>
      <p className="c2-notice" role="note">{lib.note}</p>
      <p className="small"><Link href={`/learn/track/${lib.slug}`}>Back to the track<span className="sr-only">: {lib.name}</span></Link></p>
      <div className="ui-field" role="search">
        <label htmlFor={searchId}>Search the lessons</label>
        <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      <p role="status" className="small muted">{query.trim() ? `${shown.length} of ${lib.entries.length} lessons match.` : `${lib.entries.length} lessons.`}</p>
      {rounds.map((r) => (
        <section key={r} className="ui-block" aria-labelledby={`lib-r${r}`}>
          <h2 id={`lib-r${r}`}>Round {r}</h2>
          {shown.filter((e) => e.round === r).map((e) => (
            <article key={e.lessonId} className="c2-entries" aria-labelledby={`lib-${e.lessonId}`}>
              <h3 id={`lib-${e.lessonId}`}>Section {e.section}: {e.sectionTitle} · {e.title}</h3>
              {e.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            </article>
          ))}
        </section>
      ))}
      {lib.lockedRounds.length > 0 && (
        <section className="ui-block" aria-labelledby="lib-locked">
          <h2 id="lib-locked">Not open yet</h2>
          <ul className="ui-rows">
            {lib.lockedRounds.map((r) => <li key={r.round}><span>Round {r.round}</span><span className="small muted">{r.reason ?? "Not open yet."}</span></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
