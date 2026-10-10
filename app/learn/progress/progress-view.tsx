"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "../../call";
import { progressFrom, type MyProgress, type ModuleState } from "../../progress-api";
import { Icon } from "../../ui/icons";
import { Loading } from "../../ui/loading";
import { Meter } from "../../ui/meter";
import "../c2.css";

/**
 * C2: "My progress": rank, streak, each course with its modules (open, half open, locked with the reason), the plan
 * overview, skills, and scores over time. Everything here is decided on the server; this page only shows it. Private:
 * teens see the same, and nothing on this page is shown to anyone else.
 */
export const STATE_LABEL: Record<ModuleState, string> = { open: "Open", half: "Half open", locked: "Locked" };

export function ProgressView() {
  const [p, setP] = useState<MyProgress | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/learn/progress").then((r) => {
      const v = r._status === 200 ? progressFrom(r) : null;
      setP(v);
      setFailed(v ? null : r.reason ?? "Couldn't load your progress.");
    });
  }, []);
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!p) return <Loading shape="list" />;
  const best = Math.max(1, ...p.pointsByDay.map((d) => d.points));
  return (
    <>
      <section className="ui-block" aria-labelledby="rank-h">
        <h2 id="rank-h">Rank and streak</h2>
        <dl className="c2-stats">
          <div><dt>Rank</dt><dd>{p.rank.name}</dd></div>
          <div><dt>Points</dt><dd>{p.rank.points}</dd></div>
          <div><dt>Streak</dt><dd>{p.streak.current} {p.streak.current === 1 ? "day" : "days"}</dd></div>
          <div><dt>Longest streak</dt><dd>{p.streak.longest} {p.streak.longest === 1 ? "day" : "days"}</dd></div>
        </dl>
        <p className="small">{p.rank.next ? <>Next rank: {p.rank.next.name}, {p.rank.next.needs} more points.</> : "You've reached the top rank."}</p>
        <p className="small muted">
          Points come from items you finish: Should know {p.pointsFor.shouldKnow}, Important {p.pointsFor.important}, Very important {p.pointsFor.veryImportant}.
          A day counts for your streak when you finish at least one item before midnight ({p.timeZone}). A missed day starts it again. {p.note}
        </p>
        <p className="small"><Link href="/learn/notebook">Notebook</Link> · <Link href="/learn/leaderboard">Leaderboard</Link></p>
      </section>

      <section className="ui-block" aria-labelledby="plan-h">
        <h2 id="plan-h">Your courses</h2>
        {!p.courses.length && <p className="muted">No courses yet. <Link href="/learn/choose">Choose your path</Link>.</p>}
        {p.courses.map((c) => (
          <article key={c.slug} aria-labelledby={`pc-${c.slug}`} className="ui-module">
            <h3 id={`pc-${c.slug}`}>{c.name}</h3>
            <p className="small muted">
              {c.tier ? `${c.tier} course · ` : ""}{c.done} of {c.items} items done · {c.complete ? "Course complete" : `${c.percent}%`}
              {c.bonus ? " · Trial bonus: half of module 3" : ""}{c.pickStatus === "paused" ? " · Past course (set aside)" : ""}
            </p>
            <Meter value={c.done} max={Math.max(1, c.items)} />
            <ol className="c2-modules" aria-label={`Modules of ${c.name}`}>
              {c.modules.map((m) => (
                <li key={m.position} data-state={m.state}>
                  <span className="c2-state">
                    {m.state === "locked" && <Icon name="lock" size={16} />}
                    <strong>Module {m.position}: {m.title}</strong>
                    <span className="ui-badge">{m.done ? "Done" : STATE_LABEL[m.state]}</span>
                    {m.gated && <span className="ui-badge">Rank gate</span>}
                  </span>
                  <span className="small muted">{m.doneCount} of {m.itemCount} items done</span>
                  {m.reason && !m.done && <p className="c2-reason">{m.reason}</p>}
                </li>
              ))}
            </ol>
            {c.capstone && (
              <p className="small">
                Capstone: {c.capstone.title} · {c.capstone.done ? "done" : "not done yet"} · <Link href={`/learn/capstone/${c.courseId}`}>Open the capstone<span className="sr-only">: {c.name}</span></Link>
              </p>
            )}
          </article>
        ))}
        {p.pastCourses.length > 0 && <p className="small muted">Past courses stay viewable on Pro.</p>}
      </section>

      {p.skills.length > 0 && (
        <section className="ui-block" aria-labelledby="skills-h">
          <h2 id="skills-h">Skills</h2>
          <ul className="ui-rows">
            {p.skills.map((s) => <li key={s.slug}><span>{s.name}</span><span className="small muted">{s.percent}% · skill rank {s.rank?.name ?? "Initiate"}</span></li>)}
          </ul>
        </section>
      )}

      <section className="ui-block" aria-labelledby="time-h">
        <h2 id="time-h">Over time</h2>
        {p.pointsByDay.length ? (
          <ul className="c2-bars" aria-label="Points by day, last 30 days">
            {p.pointsByDay.map((d) => <li key={d.day}><span>{d.day}</span><Meter value={d.points} max={best} /><span>{d.points}</span></li>)}
          </ul>
        ) : <p className="muted small">Nothing finished yet.</p>}
        {p.scores.length > 0 && (
          <>
            <h3>Quiz scores</h3>
            <ul className="ui-rows">{p.scores.map((s) => <li key={s.day}><span>{s.day}</span><span className="small muted">average {s.average}% over {s.attempts} {s.attempts === 1 ? "try" : "tries"}</span></li>)}</ul>
          </>
        )}
      </section>
    </>
  );
}
