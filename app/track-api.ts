/**
 * S1: how the track and library pages read their APIs (GET /api/v1/learn/tracks/{slug} and /library). Each reader takes
 * a response body exactly as the route sends it and returns the typed value, or null when the shape isn't the one
 * expected. tests/integration/skill-tracks.test.ts and the component tests feed real answers through them.
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const strOrNull = (v: unknown) => v === null || str(v);

export type TrackItem = { kind: "video" | "activity"; id: string; title: string; part: string | null; importanceLabel: string | null; points: number; done: boolean; open: boolean };
export type TrackStep = { lessonId: string; title: string; summary: string | null; items: TrackItem[] };
export type TrackSection = {
  id: string; number: number; title: string; state: "open" | "half" | "locked"; reason: string | null; doneCount: number; itemCount: number; done: boolean; steps: TrackStep[];
};
export type TrackRound = {
  round: number; label: string; goal: string | null; state: "open" | "locked"; reason: string | null; complete: boolean; doneCount: number; itemCount: number; sections: TrackSection[];
};
export type Track = { slug: string; name: string; plan: string; version: number; rank: { name: string; points: number }; rounds: TrackRound[]; note: string };

const itemOk = (i: unknown) => obj(i) && (i.kind === "video" || i.kind === "activity") && str(i.id) && str(i.title) && strOrNull(i.part) && strOrNull(i.importanceLabel)
  && num(i.points) && bool(i.done) && bool(i.open);
const stepOk = (s: unknown) => obj(s) && str(s.lessonId) && str(s.title) && strOrNull(s.summary) && arr(s.items) && s.items.every(itemOk);
const sectionOk = (s: unknown) => obj(s) && str(s.id) && num(s.number) && str(s.title) && (s.state === "open" || s.state === "half" || s.state === "locked")
  && strOrNull(s.reason) && num(s.doneCount) && num(s.itemCount) && bool(s.done) && arr(s.steps) && s.steps.every(stepOk);
const roundOk = (r: unknown) => obj(r) && num(r.round) && str(r.label) && strOrNull(r.goal) && (r.state === "open" || r.state === "locked") && strOrNull(r.reason)
  && bool(r.complete) && num(r.doneCount) && num(r.itemCount) && arr(r.sections) && r.sections.every(sectionOk);

export function trackFrom(body: unknown): Track | null {
  if (!obj(body) || !str(body.slug) || !str(body.name) || !str(body.plan) || !num(body.version) || !obj(body.rank) || !str(body.rank.name) || !num(body.rank.points)) return null;
  if (!arr(body.rounds) || !body.rounds.every(roundOk) || !str(body.note)) return null;
  return body as unknown as Track;
}

export type LibraryEntry = { round: number; section: number; sectionTitle: string; lessonId: string; title: string; paragraphs: string[] };
export type TrackLibrary = { slug: string; name: string; entries: LibraryEntry[]; lockedRounds: { round: number; reason: string | null }[]; note: string };
export function libraryFrom(body: unknown): TrackLibrary | null {
  if (!obj(body) || !str(body.slug) || !str(body.name) || !arr(body.entries) || !arr(body.lockedRounds) || !str(body.note)) return null;
  if (!body.entries.every((e) => obj(e) && num(e.round) && num(e.section) && str(e.sectionTitle) && str(e.lessonId) && str(e.title) && arr(e.paragraphs) && e.paragraphs.every(str))) return null;
  if (!body.lockedRounds.every((r) => obj(r) && num(r.round) && strOrNull(r.reason))) return null;
  return body as unknown as TrackLibrary;
}

/** The library's search: every word must appear in the lesson's title, section or text (case-insensitive). */
export function searchLibrary(entries: LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => {
    const hay = [e.title, e.sectionTitle, ...e.paragraphs].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
