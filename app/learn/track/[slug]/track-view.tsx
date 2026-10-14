"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { call } from "../../../call";
import { trackFrom, type Track, type TrackItem, type TrackRound } from "../../../track-api";
import { SANDBOX_LABEL } from "@/lib/courses/structure";
import { Icon } from "../../../ui/icons";
import { Loading } from "../../../ui/loading";
import { Meter } from "../../../ui/meter";
import { Tabs } from "../../../ui/tabs";
import "../../c2.css";

/**
 * S1: a skill track. A Round selector (tabs: arrow keys, Home and End), then the Round's 5 sections in order. Each step
 * is the short lesson, then its tasks. Every state and reason comes from the server; a locked Round says which plan
 * includes it, and a locked section's lesson text is never sent. "Round complete", never "Course complete".
 */
const STATE_LABEL = { open: "Open", half: "Half open", locked: "Locked" } as const;
const PART: Record<string, string> = { video: "Video", quiz: "Quiz", assignment: "Assignment", sandbox: SANDBOX_LABEL, sequence: "Interactive sequence", booster: "Learning booster" };

export function TrackView({ slug, initial }: { slug: string; initial?: Track | null }) {
  const [t, setT] = useState<Track | null>(initial ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (initial) return;
    void call("GET", `/api/v1/learn/tracks/${encodeURIComponent(slug)}`).then((r) => {
      const v = r._status === 200 ? trackFrom(r) : null;
      setT(v);
      setFailed(v ? null : r.reason ?? "Couldn't load this track.");
    });
  }, [slug, initial]);
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!t) return <Loading shape="list" />;
  return (
    <>
      <p className="c2-notice" role="note">{t.note}</p>
      <p className="small"><Link href={`/learn/track/${t.slug}/library`}>Open the library<span className="sr-only">: every lesson you can read in {t.name}</span></Link></p>
      <Tabs label="Rounds" tabs={t.rounds.map((r) => ({
        key: `r${r.round}`,
        label: `Round ${r.round}${r.state === "locked" ? " (locked)" : r.complete ? " (complete)" : ""}`,
        content: <RoundPanel r={r} />,
      }))} />
    </>
  );
}

function RoundPanel({ r }: { r: TrackRound }) {
  return (
    <section aria-labelledby={`round-${r.round}-h`} className="ui-block">
      <h2 id={`round-${r.round}-h`}>{r.label}</h2>
      {r.goal && <p>{r.goal}</p>}
      <p className="small muted">{r.complete ? "Round complete" : `${r.doneCount} of ${r.itemCount} items done`}</p>
      <Meter value={r.doneCount} max={Math.max(1, r.itemCount)} />
      {r.state === "locked" && r.reason && <p className="c2-reason" role="note"><Icon name="lock" size={16} /> {r.reason}</p>}
      <ol className="c2-modules" aria-label={`Sections of Round ${r.round}`}>
        {r.sections.map((s) => (
          <li key={s.id} data-state={s.state}>
            <h3 className="c2-state">
              {s.state === "locked" && <Icon name="lock" size={16} />}
              <span>Section {s.number}: {s.title}</span>
              <span className="ui-badge">{s.done ? "Done" : STATE_LABEL[s.state]}</span>
            </h3>
            <span className="small muted">{s.doneCount} of {s.itemCount} items done</span>
            {s.reason && !s.done && <p className="c2-reason">{s.reason}</p>}
            {s.state !== "locked" && s.steps.map((st, i) => (
              <div key={st.lessonId} className="c2-step">
                <h4>Step {i + 1}: {st.title}</h4>
                {st.summary && <p className="small">{st.summary}</p>}
                <p className="small"><Link href={`/learn/${st.lessonId}`}>Read the lesson<span className="sr-only">: {st.title}</span></Link></p>
                {st.items.length > 0 && (
                  <ul className="c2-items" aria-label={`Tasks for ${st.title}`}>
                    {st.items.map((it) => <ItemRow key={it.id} it={it} lessonId={st.lessonId} />)}
                  </ul>
                )}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ItemRow({ it, lessonId }: { it: TrackItem; lessonId: string }) {
  return (
    <li>
      <span className="ui-badge">{PART[it.part ?? it.kind] ?? "Task"}</span>
      <span>{it.title}</span>
      <span className="small muted">{it.importanceLabel ? `${it.importanceLabel} · ` : ""}{it.points} {it.points === 1 ? "point" : "points"}</span>
      {it.done ? <span className="ui-badge">Done</span> : it.open ? <Link href={`/learn/${lessonId}`}>Start<span className="sr-only">: {it.title}</span></Link> : <span className="small muted">Not open yet</span>}
    </li>
  );
}
