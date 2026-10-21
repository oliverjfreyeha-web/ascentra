/**
 * Design rebuild D5 · The Profile dashboard's numbers, from the learner's real progress (GET /api/v1/learn/progress)
 * and nothing else. Pure, for tests. Points per day only: minutes are never recorded, so never shown (decision 8).
 */
import { RANKS } from "@/lib/progress/config";
import type { MyProgress, ProgressCourse, ProgressModule } from "../../../progress-api";

const DAY = 86_400_000;
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Today in the learner's time zone ("YYYY-MM-DD"), as the server counts days. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch { return now.toISOString().slice(0, 10); }
}

/** The courses counted on the Profile: active ones (a paused, set-aside course is left out). */
const active = (p: MyProgress) => p.courses.filter((c) => c.pickStatus !== "paused");

/** Overall progress across active courses: items done of items. Null when there is nothing to count. */
export function overall(p: MyProgress): { done: number; items: number; percent: number } | null {
  const cs = active(p);
  const items = cs.reduce((n, c) => n + c.items, 0), done = cs.reduce((n, c) => n + c.done, 0);
  return items > 0 ? { done, items, percent: Math.round((done / items) * 100) } : null;
}

/** Points by day as a lookup. */
export const pointsMap = (p: MyProgress) => new Map(p.pointsByDay.map((d) => [d.day, d.points]));

/** The last 7 days ending today: each day's points (0 when nothing was finished). */
export function lastDays(p: MyProgress, today: string, n = 7): { day: string; points: number; today: boolean }[] {
  const m = pointsMap(p), t = dayNum(today);
  return Array.from({ length: n }, (_, i) => { const day = dayStr(t - (n - 1) + i); return { day, points: m.get(day) ?? 0, today: i === n - 1 }; });
}

/** The sparkline: points per day for the last 30 days, as an SVG path in a 120 × 40 box. Null with no points at all. */
export function sparkline(p: MyProgress, today: string, n = 30): { line: string; area: string; last: [number, number]; total: number; todayPoints: number } | null {
  const days = lastDays(p, today, n);
  const total = days.reduce((s, d) => s + d.points, 0);
  if (!p.pointsByDay.length) return null;
  const max = Math.max(1, ...days.map((d) => d.points));
  const pts = days.map((d, i) => [+(i * (120 / (n - 1))).toFixed(1), +(36 - (d.points / max) * 32).toFixed(1)] as [number, number]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return { line, area: `${line} L120 40 L0 40Z`, last: pts[pts.length - 1], total, todayPoints: days[days.length - 1].points };
}

// ============ Activity grid (points per day) ============

export type Level = "rest" | "miss" | "short" | "steady" | "focus" | "grind";
export const LEVELS: { key: Level; label: string; rule: string }[] = [
  { key: "rest", label: "Rest", rule: "no items finished" },
  { key: "miss", label: "Missed", rule: "the day a streak reset" },
  { key: "short", label: "Short", rule: "1 to 2 points" },
  { key: "steady", label: "Steady", rule: "3 to 5 points" },
  { key: "focus", label: "Focused", rule: "6 to 9 points" },
  { key: "grind", label: "Grind", rule: "10 points or more" },
];
/** A day's level from its points. A day with none right after a day with points is the day the streak reset ("Missed"),
 *  except today, which isn't over yet. */
export function levelOf(points: number, prevPoints: number, isToday: boolean): Level {
  if (points >= 10) return "grind";
  if (points >= 6) return "focus";
  if (points >= 3) return "steady";
  if (points >= 1) return "short";
  return prevPoints > 0 && !isToday ? "miss" : "rest";
}
export type Cell = { day: string; points: number; level: Level; today: boolean };
/** Every day from `from` to today (inclusive), with its level. */
export function cells(p: MyProgress, today: string, from: string): Cell[] {
  const m = pointsMap(p), t = dayNum(today), out: Cell[] = [];
  for (let n = dayNum(from); n <= t; n++) {
    const day = dayStr(n), points = m.get(day) ?? 0;
    out.push({ day, points, level: levelOf(points, m.get(dayStr(n - 1)) ?? 0, n === t), today: n === t });
  }
  return out;
}
export const firstOfMonth = (today: string) => `${today.slice(0, 8)}01`;
export const yearStart = (today: string) => dayStr(dayNum(today) - 364);
export const weekStart = (today: string) => dayStr(dayNum(today) - 6);
/** "Sat, Oct 18" for a day (UTC, so the day never shifts). */
export const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
export function cellText(c: Cell): string {
  const lvl = LEVELS.find((l) => l.key === c.level)!;
  const what = c.points ? `${c.points} ${c.points === 1 ? "point" : "points"} · ${lvl.label}` : c.level === "miss" ? "no items finished · streak reset" : c.today ? "nothing finished yet today" : "no items finished";
  return `${dayLabel(c.day)} · ${what}`;
}

// ============ Rank ladder ============

/** The named rank tiers, lowest to highest, with the learner's place on the ladder (a tier, never a position). */
export function ladder(p: MyProgress) {
  return RANKS.map((r, i) => ({ name: r.name, points: r.points, reached: i + 1 <= p.rank.index, current: i + 1 === p.rank.index }));
}

// ============ Course map ============

export type NodeState = "done" | "now" | "next" | "locked";
export type MapNode = { m: ProgressModule; state: NodeState; label: string };
export type MapBranch = { course: ProgressCourse; nodes: MapNode[]; href: string; summary: string };
/** One branch per active course; nodes are its real sections, in order. The first open, unfinished one is "now"; other
 *  open ones are "next"; locked ones are "locked"; finished ones "done". */
export function courseMap(p: MyProgress): MapBranch[] {
  return active(p).filter((c) => c.modules.length > 0).map((c) => {
    const multi = new Set(c.modules.map((m) => m.round ?? 1)).size > 1;
    let nowSet = false;
    const nodes = c.modules.map((m) => {
      let state: NodeState;
      if (m.done) state = "done";
      else if (m.state === "locked") state = "locked";
      else if (!nowSet) { state = "now"; nowSet = true; } else state = "next";
      return { m, state, label: multi && m.round ? `R${m.round} · ${m.title}` : m.title };
    });
    const summary = c.track ? `${c.track.rounds.filter((r) => r.complete).length} of ${c.track.rounds.length} Rounds · ${c.done} of ${c.items} items` : `${nodes.filter((n) => n.state === "done").length} of ${nodes.length} sections · ${c.done} of ${c.items} items`;
    return { course: c, nodes, href: c.track ? `/learn/track/${c.slug}` : "/learn", summary };
  });
}
