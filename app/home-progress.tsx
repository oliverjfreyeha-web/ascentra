"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "./call";
import { useMe } from "./use-me";
import { progressFrom, type MyProgress, type ProgressCourse, type ProgressModule } from "./progress-api";
import { CountUp } from "./ui/count-up";
import { Glass } from "./ui/design/glass-panel";
import { Icon } from "./ui/design/ds-icon";

const STATE_LABEL = { open: "Open", half: "Half open", locked: "Locked" } as const;

/**
 * The course to show on Home: the first active one that isn't finished (paused courses are skipped). For a skill track,
 * its current Round is the first open one that isn't complete; its sections are that Round's. Pure, for tests.
 */
export function homeView(p: MyProgress) {
  const course = p.courses.find((c) => !c.complete && c.pickStatus !== "paused") ?? null;
  if (!course) return null;
  const rounds = course.track?.rounds ?? null;
  const round = rounds ? rounds.find((r) => r.state === "open" && !r.complete) ?? null : null;
  const sections = rounds ? course.modules.filter((m) => m.round === (round?.round ?? null)) : course.modules;
  const next = sections.find((m) => !m.done && m.state !== "locked") ?? null;
  const href = rounds ? `/learn/track/${course.slug}` : "/learn";
  return { course, round, roundCount: rounds?.length ?? 0, sections, next, href };
}

/**
 * Design rebuild D4 · Home for a learner: Up next, the stats strip and the current Round's (or course's) section cards.
 * Every number is the learner's real progress, read from the same API as My progress (GET /api/v1/learn/progress); no
 * new API, route or permission. Guardians, who don't learn, never ask. If the read fails, or there is no active course,
 * nothing shows (decision 7: no invented numbers). The rank is the named tier, never a position among learners.
 */
export function HomeProgress() {
  const state = useMe();
  const learns = state.status === "ready" && state.me.roleKey !== "guardian";
  const [p, setP] = useState<MyProgress | null>(null);
  useEffect(() => {
    if (!learns) return;
    let live = true;
    void call("GET", "/api/v1/learn/progress").then((r) => { if (live) setP(r._status === 200 ? progressFrom(r) : null); });
    return () => { live = false; };
  }, [learns]);
  if (!learns || !p) return null;
  const v = homeView(p);
  return (
    <div className="home-prog ds-stagger">
      {v?.next && <UpNext course={v.course} m={v.next} href={v.href} />}
      <dl className="home-stats" aria-label="Your progress">
        <div className="home-stat">
          <dt className="ds-caps">Rank</dt>
          <dd><b className="ds-num home-stat__big">{p.rank.name}</b><span className="small muted"><CountUp value={p.rank.points} /> {p.rank.points === 1 ? "point" : "points"}</span></dd>
        </div>
        <div className="home-stat">
          <dt className="ds-caps">Streak</dt>
          <dd><b className="ds-num home-stat__big"><CountUp value={p.streak.current} /></b><span className="small muted">{p.streak.current === 1 ? "day" : "days"} · best {p.streak.longest}</span></dd>
        </div>
        {v && (
          <div className="home-stat">
            <dt className="ds-caps">{v.round ? `Round ${v.round.round}` : "Sections"}</dt>
            <dd><b className="ds-num home-stat__big"><CountUp value={v.sections.filter((m) => m.done).length} /></b><span className="small muted">of {v.sections.length} done</span></dd>
          </div>
        )}
        {v?.round && (
          <div className="home-stat">
            <dt className="ds-caps">Rounds</dt>
            <dd><b className="ds-num home-stat__big">{v.round.round}</b><span className="small muted">of {v.roundCount}</span></dd>
          </div>
        )}
      </dl>
      <p className="small muted home-note">{p.note}</p>
      {v && v.sections.length > 0 && (
        <section className="home-secs" aria-labelledby="home-secs-h">
          <h2 id="home-secs-h" className="ds-display home-secs__h">{v.round ? `${v.course.name} · Round ${v.round.round}` : v.course.name}</h2>
          <ol className="home-secs__grid">
            {v.sections.map((m, i) => <SectionCard key={m.position} m={m} n={i + 1} href={v.href} accent={(i % 5) + 1} />)}
          </ol>
        </section>
      )}
    </div>
  );
}

function UpNext({ course, m, href }: { course: ProgressCourse; m: ProgressModule; href: string }) {
  return (
    <Glass className="home-next">
      <div className="home-next__text">
        <p className="ds-caps">Up next</p>
        <p className="home-next__title">Section {m.position} · {m.title}</p>
        <p className="small muted">{course.name} · {m.doneCount} of {m.itemCount} items done</p>
      </div>
      <Link href={href} className="ds-btn ds-btn--primary" data-sfx="nav"><Icon name="book" size={18} /><span>Continue<span className="sr-only">: {m.title}</span></span></Link>
    </Glass>
  );
}

/** A section card: one link, so it may tilt a little (decision 6). The state chip says it in words, never colour alone. */
function SectionCard({ m, n, href, accent }: { m: ProgressModule; n: number; href: string; accent: number }) {
  const chip = m.done ? "Done" : STATE_LABEL[m.state];
  return (
    <li className="home-sec__li">
      <Glass as={Link} href={href} tilt className="home-sec" data-state={m.done ? "done" : m.state} data-sfx="nav" style={{ ["--acc" as string]: `var(--accent-${accent})` }}>
        <span className="home-sec__n ds-num" aria-hidden="true">{n}</span>
        <span className="home-sec__title">{m.title}</span>
        <span className="home-sec__meta small">{m.doneCount} of {m.itemCount} items done</span>
        <span className="home-sec__chip">{m.state === "locked" && !m.done && <Icon name="lock" size={14} />}{chip}</span>
        {m.state === "locked" && m.reason && !m.done && <span className="home-sec__reason small">{m.reason}</span>}
      </Glass>
    </li>
  );
}
