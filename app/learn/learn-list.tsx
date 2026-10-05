"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "../call";
import { learnerCoursesFrom, type LearnerCourse } from "../courses-api";

/** L2: published courses and lessons only (the API never returns a Draft or a version in Review). */
export function LearnList() {
  const [courses, setCourses] = useState<LearnerCourse[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/learn/courses").then((r) => {
      const list = r._status === 200 ? learnerCoursesFrom(r) : null;
      setCourses(list);
      setFailed(list ? null : r.reason ?? "Couldn't load your courses.");
    });
  }, []);
  if (failed) return <p role="status">{failed}</p>;
  if (!courses) return <p className="muted">Loading…</p>;
  if (!courses.length) return <p className="muted">No published lessons yet.</p>;
  return (
    <>
      {courses.map((c) => (
        <section key={c.slug} aria-labelledby={`c-${c.slug}`}>
          <h2 id={`c-${c.slug}`}>{c.name}</h2>
          {c.modules.map((m, i) => (
            <div key={i}>
              <h3>{m.title}</h3>
              <ul>
                {m.lessons.map((l) => (
                  <li key={l.id}>
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
