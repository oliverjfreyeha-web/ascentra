"use client";

import { useState } from "react";
import type { MyProgress } from "../../../progress-api";
import { Segmented } from "../../../ui/design/segmented";
import { cells, cellText, dayLabel, firstOfMonth, LEVELS, weekday, weekStart, yearStart, type Cell } from "./profile-data";

type View = "week" | "month" | "year";
const VIEWS = [["week", "Week"], ["month", "Month"], ["year", "Year"]] as const;
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Design rebuild D5 · The activity grid: points per day (decision 8; minutes are never recorded, so never shown), for the
 * last week, this month, or the last 365 days. Colours per DESIGN.md (rest, missed, short, steady, focused, grind), with
 * the words in each cell's label, the line under the grid and the legend (colour is never the only signal).
 */
export function ActivityGrid({ p, today }: { p: MyProgress; today: string }) {
  const [view, setView] = useState<View>("week");
  const [tip, setTip] = useState<Cell | null>(null);
  const from = view === "week" ? weekStart(today) : view === "month" ? firstOfMonth(today) : yearStart(today);
  const list = cells(p, today, from);
  const total = list.reduce((s, c) => s + c.points, 0), activeDays = list.filter((c) => c.points > 0).length;
  const cell = (c: Cell, big: 0 | 1 | 2) => (
    <div key={c.day} role="img" tabIndex={big ? 0 : -1} className={`pf-ac pf-ac--${c.level}${c.today ? " pf-ac--today" : ""}`} aria-label={cellText(c)}
      onPointerEnter={() => setTip(c)} onPointerLeave={() => setTip(null)} onFocus={() => setTip(c)} onBlur={() => setTip(null)}>
      {big ? <b aria-hidden="true">{Number(c.day.slice(8))}</b> : null}
      {big === 2 && <small aria-hidden="true">{c.points ? `${c.points} pt` : "—"}</small>}
    </div>
  );
  let body;
  if (view === "week") {
    body = <div className="pf-ag pf-ag--week">{list.map((c) => <div key={c.day} className="pf-ag__col"><small aria-hidden="true">{DOW[weekday(c.day)]}</small>{cell(c, 2)}</div>)}</div>;
  } else if (view === "month") {
    body = (
      <div className="pf-ag pf-ag--month">
        <div className="pf-ag__dow" aria-hidden="true">{DOW.map((d) => <small key={d}>{d}</small>)}</div>
        <div className="pf-ag__mgrid">{Array.from({ length: weekday(from) }, (_, i) => <i key={`p${i}`} aria-hidden="true" />)}{list.map((c) => cell(c, 1))}</div>
      </div>
    );
  } else {
    const lead = weekday(from), weeks = Math.ceil((lead + list.length) / 7);
    const labels: { col: number; m: string }[] = [];
    list.forEach((c, i) => { const col = Math.floor((lead + i) / 7); if (Number(c.day.slice(8)) <= 7 && weekday(c.day) === 0 && !labels.some((l) => l.col === col)) labels.push({ col, m: MON[Number(c.day.slice(5, 7)) - 1] }); });
    body = (
      <div className="pf-ag pf-ag--year" style={{ ["--weeks" as string]: weeks }}>
        <div className="pf-ag__months" aria-hidden="true">{labels.map((l) => <small key={l.col} style={{ gridColumn: l.col + 1 }}>{l.m}</small>)}</div>
        <div className="pf-ag__ygrid" role="group" aria-label={`Last 365 days, ${dayLabel(from)} to ${dayLabel(today)}`}>{Array.from({ length: lead }, (_, i) => <i key={`p${i}`} aria-hidden="true" />)}{list.map((c) => cell(c, 0))}</div>
      </div>
    );
  }
  return (
    <div className="pf-act">
      <div className="pf-act__bar">
        <Segmented label="Activity range" value={view} onChange={setView} options={VIEWS} />
        <span className="small pf-act__total">{total} {total === 1 ? "point" : "points"} over {activeDays} {activeDays === 1 ? "day" : "days"}</span>
      </div>
      <div className="pf-act__scroll">{body}</div>
      <p className="small pf-act__tip" aria-live="polite">{tip ? cellText(tip) : "Hover or focus a day to see its points."}</p>
      <ul className="pf-act__legend" aria-label="Legend">
        {LEVELS.map((l) => <li key={l.key}><i className={`pf-ac pf-ac--${l.key}`} aria-hidden="true" /><span>{l.label}</span><small className="muted">{l.rule}</small></li>)}
      </ul>
    </div>
  );
}
