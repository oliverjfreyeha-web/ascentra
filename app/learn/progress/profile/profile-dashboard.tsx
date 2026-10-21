"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MyProgress } from "../../../progress-api";
import { PROFILE_WIDGETS, readHiddenWidgets, writeHiddenWidgets, type ProfileWidget } from "../../../env/prefs";
import { CountUp } from "../../../ui/count-up";
import { Glass } from "../../../ui/design/glass-panel";
import { Icon, type IconName } from "../../../ui/design/ds-icon";
import { ActivityGrid } from "./activity-grid";
import { CourseMap } from "./course-map";
import { courseMap, lastDays, ladder, overall, sparkline, todayIn } from "./profile-data";
import "./profile.css";

/** The globe's WebGL part: its own chunk, loaded in the browser only; the poster shows until (and unless) it runs. */
const GlobeCanvas = dynamic(() => import("./globe-canvas"), { ssr: false, loading: () => null });

const TITLES: Record<ProfileWidget, string> = { globe: "Progress globe", streak: "Streak", points: "Points", rank: "Rank", activity: "Activity", map: "Course map" };
const ICONS: Partial<Record<ProfileWidget, IconName>> = { streak: "flame", points: "bolt", rank: "trophy" };
const ACCENT: Partial<Record<ProfileWidget, string>> = { streak: "var(--widget-streak)", points: "var(--widget-points)", rank: "var(--widget-rank)", globe: "var(--widget-next)" };

/**
 * Design rebuild D5 · The Profile dashboard on "My progress": real data only (decision 7). Widgets: progress globe,
 * streak, points, activity grid (points per day; decision 8), rank (the named tier, never a position), course map.
 * A widget whose data is missing is not shown at all (and the chooser says so). Trophies, coins, badges, Next reward,
 * Recent activity and the Review deck are not built. Widgets never tilt (decision 6). The person's choice of widgets is
 * kept in this browser with the other appearance preferences.
 */
export function ProfileDashboard({ p }: { p: MyProgress }) {
  const today = todayIn(p.timeZone);
  const [hidden, setHidden] = useState<ProfileWidget[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this browser's saved choice after hydration
    setHidden(readHiddenWidgets());
  }, []);
  const save = (next: ProfileWidget[]) => { setHidden(next); writeHiddenWidgets(next); };
  const toggle = (w: ProfileWidget) => save(hidden.includes(w) ? hidden.filter((x) => x !== w) : [...hidden, w]);

  const all = overall(p), spark = sparkline(p, today), branches = courseMap(p);
  /** Which widgets have real data to show. */
  const has: Record<ProfileWidget, boolean> = {
    globe: !!all, streak: true, points: true, rank: true, activity: p.pointsByDay.length > 0, map: branches.length > 0,
  };
  const body: Record<ProfileWidget, () => ReactNode> = {
    globe: () => <GlobeWidget all={all!} />,
    streak: () => <StreakWidget p={p} today={today} />,
    points: () => <PointsWidget p={p} spark={spark} />,
    rank: () => <RankWidget p={p} />,
    activity: () => <ActivityGrid p={p} today={today} />,
    map: () => <CourseMap branches={branches} />,
  };
  const shown = PROFILE_WIDGETS.filter((w) => has[w] && !hidden.includes(w));
  return (
    <section className="pf" aria-labelledby="pf-h">
      <div className="pf__head">
        <h2 id="pf-h" className="ds-display pf__title">Your dashboard</h2>
        <WidgetMenu hidden={hidden} has={has} onToggle={toggle} />
      </div>
      {shown.length === 0 && <p className="muted">All widgets are hidden. Choose some with the widgets menu.</p>}
      <div className="pf-grid ds-stagger">
        {shown.map((w) => (
          <Glass widget as="article" key={w} className={`pf-w pf-w--${w}`} aria-labelledby={`pf-${w}`} style={ACCENT[w] ? { ["--wa" as string]: ACCENT[w] } : undefined}>
            <header className="pf-w__head">
              {ICONS[w] && <span className="pf-w__ico" aria-hidden="true"><Icon name={ICONS[w]!} size={20} /></span>}
              <h3 id={`pf-${w}`} className="ds-caps pf-w__title">{TITLES[w]}</h3>
              <button type="button" className="ds-btn ds-btn--icon ds-btn--sm ds-glass pf-w__x" aria-label={`Hide ${TITLES[w]}`} data-sfx="remove" onClick={() => toggle(w)}>
                <Icon name="x" size={14} />
              </button>
            </header>
            {body[w]()}
          </Glass>
        ))}
      </div>
    </section>
  );
}

/** The widget chooser: a menu button and a small glass panel of checkboxes. Escape or a click outside closes it. */
function WidgetMenu({ hidden, has, onToggle }: { hidden: ProfileWidget[]; has: Record<ProfileWidget, boolean>; onToggle: (w: ProfileWidget) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId(), wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);
  return (
    <div className="pf-menu" ref={wrap}>
      <button ref={btn} type="button" className="ds-btn ds-btn--icon ds-glass" aria-label="Choose widgets" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name="dots" size={18} />
      </button>
      {open && (
        <div id={id} className="pf-menu__pop ds-glass ds-glass--hud" role="group" aria-label="Widgets">
          <p className="ds-caps">Widgets</p>
          {PROFILE_WIDGETS.map((w) => (
            <label key={w} className="pf-menu__opt">
              <input type="checkbox" checked={!hidden.includes(w)} disabled={!has[w]} onChange={() => onToggle(w)} />
              <span>{TITLES[w]}{!has[w] && <small className="muted"> · no data yet</small>}</span>
            </label>
          ))}
          <p className="small muted">Saved in this browser only.</p>
        </div>
      )}
    </div>
  );
}

function GlobeWidget({ all }: { all: { done: number; items: number; percent: number } }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    // The 3D globe only where effects are full: not in Lite mode (phones, slow devices). Otherwise the poster stays.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decided in the browser after hydration
    setLive(document.documentElement.getAttribute("data-lite") !== "1");
  }, []);
  return (
    <div className="pf-globe">
      <div className="pf-globe__stage" aria-hidden="true">
        <div className="pf-globe__poster" />
        {live && <GlobeCanvas size={260} />}
      </div>
      <div className="pf-globe__hud">
        <p className="ds-caps">Your progress</p>
        <p className="pf-big ds-num"><CountUp value={all.percent} />%</p>
        <div className="pf-bar" role="img" aria-label={`${all.done} of ${all.items} items done across your courses`}><i style={{ width: `${all.percent}%` }} /></div>
        <p className="small muted">{all.done} of {all.items} items done across your courses</p>
      </div>
    </div>
  );
}

function StreakWidget({ p, today }: { p: MyProgress; today: string }) {
  const days = lastDays(p, today);
  const active = days.filter((d) => d.points > 0).length;
  return (
    <>
      <p className="pf-big ds-num"><CountUp value={p.streak.current} /></p>
      <p className="small muted">{p.streak.current === 1 ? "day" : "days"} in a row · best {p.streak.longest}</p>
      <ol className="pf-days" aria-label={`Last 7 days: items finished on ${active} of them`}>
        {days.map((d) => (
          <li key={d.day} data-on={d.points > 0 || undefined} data-today={d.today || undefined}>
            <i aria-hidden="true" />
            <span aria-hidden="true">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}</span>
            <span className="sr-only">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}: {d.points > 0 ? "items finished" : d.today ? "nothing yet today" : "no items finished"}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function PointsWidget({ p, spark }: { p: MyProgress; spark: ReturnType<typeof sparkline> }) {
  return (
    <>
      <p className="pf-big ds-num"><CountUp value={p.rank.points} /></p>
      <p className="small muted">points in all{spark && spark.todayPoints > 0 ? ` · +${spark.todayPoints} today` : ""}</p>
      {spark ? (
        <svg className="pf-spark" viewBox="0 0 120 40" preserveAspectRatio="none" role="img" aria-label={`Points per day, last 30 days: ${spark.total} in all`}>
          <path className="pf-spark__area" d={spark.area} />
          <path className="pf-spark__line ds-draw" pathLength={1} d={spark.line} />
          <circle className="pf-spark__dot" cx={spark.last[0]} cy={spark.last[1]} r="2.4" />
        </svg>
      ) : <p className="small muted">Finish an item to start your points history.</p>}
    </>
  );
}

function RankWidget({ p }: { p: MyProgress }) {
  const steps = ladder(p);
  return (
    <>
      <p className="pf-big ds-num">{p.rank.name}</p>
      <p className="small muted">{p.rank.next ? `Next: ${p.rank.next.name}, ${p.rank.next.needs} more ${p.rank.next.needs === 1 ? "point" : "points"}` : "You've reached the top rank."}</p>
      <ol className="pf-ladder" aria-label="Rank tiers, lowest to highest">
        {steps.map((s, i) => (
          <li key={s.name} data-reached={s.reached || undefined} data-current={s.current || undefined} style={{ ["--h" as string]: `${30 + i * 7}%` }}>
            <i aria-hidden="true" />
            <span className="sr-only">{s.name}, {s.points} points{s.current ? ", your rank" : s.reached ? ", reached" : ""}</span>
          </li>
        ))}
      </ol>
      <p className="small pf-rank__links">
        <Link href="/learn/leaderboard" className="ds-btn ds-btn--glass ds-btn--sm ds-glass" data-sfx="nav"><Icon name="users" size={16} /><span>Open the leaderboard</span></Link>
      </p>
    </>
  );
}

