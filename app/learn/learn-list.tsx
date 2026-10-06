"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "../call";
import { learnerCoursesFrom, type LearnerCourse } from "../courses-api";
import { pathFrom } from "../path-api";

/** L2: published courses and lessons only (the API never returns a Draft or a version in Review). */
export function LearnList() {
  const [courses, setCourses] = useState<LearnerCourse[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // L7: after a plan or the trial starts, invite the learner to the interview (skippable; redoable from My path).
  const [askInterview, setAskInterview] = useState(false);
  useEffect(() => {
    void call("GET", "/api/v1/learn/path").then((r) => {
      const p = r._status === 200 ? pathFrom(r) : null;
      setAskInterview(!!p && !!p.plan && p.interviewNeeded);
    });
    void call("GET", "/api/v1/learn/courses").then((r) => {
      const list = r._status === 200 ? learnerCoursesFrom(r) : null;
      setCourses(list);
      setFailed(list ? null : r.reason ?? "Couldn't load your courses.");
    });
  }, []);
  const prompt = askInterview ? (
    <p className="ui-banner"><span className="ui-banner__mark" aria-hidden="true" /><span>Get a path for you: <Link href="/learn/path">answer four quick questions</Link> (you can skip it).</span></p>
  ) : <p className="small"><Link href="/learn/path" className="ui-btn ui-btn--secondary ui-btn--sm">My path</Link></p>;
  if (failed) return <>{prompt}<p role="status">{failed}</p></>;
  if (!courses) return <p className="muted">Loading…</p>;
  if (!courses.length) return <>{prompt}<p className="muted">No published lessons yet.</p></>;
  return (
    <>
      {prompt}
      {courses.map((c) => (
        <section key={c.slug} aria-labelledby={`c-${c.slug}`} className="ui-block ui-course">
          <div className="ui-course__head"><h2 id={`c-${c.slug}`}>{c.name}</h2></div>
          {c.modules.map((m, i) => (
            <div key={i} className="ui-module">
              <h3>{m.title}</h3>
              <ul className="ui-rows">
                {m.lessons.map((l) => (
                  <li key={l.id} data-done={l.done || undefined}>
                    <Link href={`/learn/${l.id}`}>{l.title}</Link>{" "}
                    <span className="muted small">{l.minutes ? `${l.minutes} min · ` : ""}last verified {l.lastVerifiedOn ?? "unknown"}{l.done ? " · done" : ""}{l.updated ? " · updated" : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
