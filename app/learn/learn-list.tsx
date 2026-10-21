"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useOnboardingGuard } from "../onboarding";
import { call } from "../call";
import { learnerCoursesFrom, type LearnerCourse } from "../courses-api";
import { pathFrom } from "../path-api";
import { Loading } from "../ui/loading";
import { Glass } from "../ui/design/glass-panel";
import { Icon, type IconName } from "../ui/design/ds-icon";
import { Segmented } from "../ui/design/segmented";
import "./library.css";

type Filter = "all" | "taking" | "new";
const FILTERS = [["all", "All"], ["taking", "Taking"], ["new", "Not started"]] as const;
/** Cover icons: chosen from the course's slug, so a course always keeps the same one. Decorative only. */
const COVERS: IconName[] = ["mail", "note", "film", "chat", "chart", "star", "target", "bolt", "book", "map"];
const cover = (slug: string) => COVERS[[...slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COVERS.length];

/** Counts from the lessons the API sent (published only), and the lesson's own "done" flag. Nothing is estimated. */
export function courseCounts(c: LearnerCourse) {
  const lessons = c.modules.flatMap((m) => m.lessons);
  const done = lessons.filter((l) => l.done).length;
  return { modules: c.modules.length, lessons: lessons.length, done, status: lessons.length && done === lessons.length ? "done" : done > 0 ? "taking" : "new" } as const;
}
const STATUS_LABEL = { done: "Done", taking: "In progress", new: "Not started" } as const;

/** Matches the course name, a module title or a lesson title (case-insensitive). */
export function matchesQuery(c: LearnerCourse, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return c.name.toLowerCase().includes(s) || c.modules.some((m) => m.title.toLowerCase().includes(s) || m.lessons.some((l) => l.title.toLowerCase().includes(s)));
}

/**
 * L2: published courses and lessons only (the API never returns a Draft or a version in Review).
 * Design rebuild D4 · the Library: a filter (All, Taking, Not started) and a search over course, module and lesson
 * titles, then course cards (cover tile, title, meta, status chip, a small lessons-done bar), the first one featured
 * and open. Every lesson link, label and fact is the one the page showed before; only the presentation changed.
 */
export function LearnList() {
  useOnboardingGuard();
  const [courses, setCourses] = useState<LearnerCourse[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // L7: after a plan or the trial starts, invite the learner to the interview (skippable; redoable from My path).
  const [askInterview, setAskInterview] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();
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
  const quick = "ds-btn ds-btn--glass ds-btn--sm ds-glass";
  const prompt = askInterview ? (
    <p className="ui-banner"><span className="ui-banner__mark" aria-hidden="true" /><span>Get a path for you: <Link href="/learn/path">answer four quick questions</Link> (you can skip it).</span></p>
  ) : <nav className="lib-quick" aria-label="Learning pages">
    <Link href="/learn/path" className={quick}>My path</Link> <Link href="/learn/choose" className={quick}>Choose your path</Link>{" "}
    <Link href="/learn/progress" className={quick}>My progress</Link> <Link href="/learn/notebook" className={quick}>Notebook</Link>{" "}
    <Link href="/learn/leaderboard" className={quick}>Leaderboard</Link> <Link href="/community" className={quick}>Community</Link></nav>;
  if (failed) return <>{prompt}<p role="status" className="ui-state ui-state--error">{failed}</p></>;
  if (!courses) return <Loading shape="list" />;
  if (!courses.length) return <>{prompt}<p className="muted ui-empty ui-empty--inline">No published lessons yet.</p></>;
  const shown = courses.filter((c) => {
    const st = courseCounts(c).status;
    return (filter === "all" || (filter === "taking" ? st !== "new" : st === "new")) && matchesQuery(c, query);
  });
  return (
    <>
      {prompt}
      <div className="lib-tools">
        <Segmented label="Show courses" value={filter} onChange={setFilter} options={FILTERS} />
        <div className="lib-search ds-glass" role="search">
          <Icon name="search" size={18} />
          <label htmlFor={searchId} className="sr-only">Search courses and lessons</label>
          <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search courses and lessons" autoComplete="off" />
        </div>
      </div>
      <p role="status" className="small muted lib-count">
        {shown.length === courses.length ? `${courses.length} ${courses.length === 1 ? "course" : "courses"}.` : `${shown.length} of ${courses.length} courses match.`}
      </p>
      {!shown.length && <p className="muted ui-empty ui-empty--inline">No course matches. Try another word or show all courses.</p>}
      <div className="lib-grid ds-stagger">
        {shown.map((c, i) => <CourseCard key={c.slug} c={c} featured={i === 0} accent={(courses.indexOf(c) % 5) + 1} />)}
      </div>
    </>
  );
}

function CourseCard({ c, featured, accent }: { c: LearnerCourse; featured: boolean; accent: number }) {
  const n = courseCounts(c);
  const [open, setOpen] = useState(featured);
  const listId = useId();
  const pct = n.lessons ? Math.round((n.done / n.lessons) * 100) : 0;
  return (
    <Glass as="section" aria-labelledby={`c-${c.slug}`} className={`lib-card${featured ? " lib-card--feat" : ""}`} style={{ ["--acc" as string]: `var(--accent-${accent})` }}>
      <div className="lib-card__top">
        <span className="lib-cover" aria-hidden="true"><i /><i /><Icon name={cover(c.slug)} size={featured ? 52 : 36} /></span>
        <div className="lib-card__body">
          <h2 id={`c-${c.slug}`} className="lib-card__title">{c.name}</h2>
          <p className="lib-card__meta small">{n.modules} {n.modules === 1 ? "module" : "modules"} · {n.lessons} {n.lessons === 1 ? "lesson" : "lessons"}</p>
          <p className="lib-card__status"><span className="lib-chip" data-status={n.status}>{STATUS_LABEL[n.status]}</span></p>
          <div className="lib-bar__track" role="img" aria-label={`${n.done} of ${n.lessons} lessons done`}><i style={{ width: `${pct}%` }} /></div>
          <p className="small muted lib-card__done" aria-hidden="true">{n.done} of {n.lessons} lessons done</p>
        </div>
      </div>
      <button type="button" className="ds-btn ds-btn--glass ds-btn--sm ds-glass lib-card__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)} data-sfx={open ? "off" : "on"}>
        <Icon name={open ? "x" : "plus"} size={16} /><span>{open ? "Hide lessons" : "Show lessons"}<span className="sr-only"> for {c.name}</span></span>
      </button>
      <div id={listId} className="lib-card__lessons" hidden={!open}>
        {c.modules.map((m, i) => (
          <div key={i} className="ui-module">
            <h3>{m.title}</h3>
            {m.pace && <p className="muted small">Recommended pace: {m.pace.toLowerCase()}, at your own speed.</p>}
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
      </div>
    </Glass>
  );
}
