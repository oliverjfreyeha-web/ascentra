import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { OWNER_ACADEMY_SLUG } from "@/lib/caps";
import { canOpenCourse } from "@/lib/courses/learn";
import { IMPORTANCE } from "./config";
import { courseState } from "./progress";
import { sectionNumber } from "./tracks";

/**
 * S1: a learner's skill track, built from the same course rows as everything else (never duplicated).
 *   Track view: the Round selector, then the Round's 5 sections in order; each step is a short lesson then its tasks.
 *   Library view: every lesson the learner can open, by Round and section, read-only. A locked section's lesson text is
 *   never sent. Every state comes from the server's unlock rules (lib/progress/tracks.ts).
 */

type Body = { summary?: string; sections?: { heading: string; paragraphs: { text: string }[] }[]; takeaways?: { text: string }[] };
type RoundMeta = { roundNumber: number; label?: string; goal?: string };

async function liveTrack(actor: Account, slug: string) {
  const db = getDb();
  if (slug === OWNER_ACADEMY_SLUG) return null;
  const academy = (await db.from("academies").select("id, slug, name").eq("slug", slug).maybeSingle()).data as { id: string; slug: string; name: string } | null;
  if (!academy) return null;
  const courses = ((await db.from("courses").select("*").eq("academy_id", academy.id)).data ?? []) as { id: string; version: number; status: string; is_track?: boolean; unpublished_at?: string | null }[];
  const live = courses.filter((c) => (c.status === "published" || c.status === "restored") && c.is_track).sort((a, b) => b.version - a.version)[0];
  if (!live || !(await canOpenCourse(actor, academy, !!live.unpublished_at))) return null;
  const bp = (((await db.from("academy_blueprints").select("plan, status, course_id").eq("course_id", live.id)).data ?? []) as { plan: { rounds?: RoundMeta[] } | null }[])[0];
  return { academy, live, meta: bp?.plan?.rounds ?? [] };
}

async function publishedBodies(lessonIds: string[]): Promise<Map<string, { title: string; body: Body }>> {
  if (!lessonIds.length) return new Map();
  const rows = ((await getDb().from("lesson_versions").select("lesson_id, title, body, status").in("lesson_id", lessonIds).eq("status", "published")).data ?? []) as { lesson_id: string; title: string; body: Body }[];
  return new Map(rows.map((r) => [r.lesson_id, { title: r.title, body: r.body }]));
}

export async function trackView(actor: Account, slug: string) {
  const t = await liveTrack(actor, slug);
  if (!t) return null;
  const st = (await courseState(actor, t.live.id))!;
  const lessons = ((await getDb().from("lessons").select("id, module_id, position, title").in("module_id", st.modules.map((m) => m.id).concat(["00000000-0000-4000-8000-000000000000"]))).data ?? []) as
    { id: string; module_id: string; position: number; title: string }[];
  const open = st.modules.filter((m) => m.state !== "locked");
  const bodies = await publishedBodies(lessons.filter((l) => open.some((m) => m.id === l.module_id)).map((l) => l.id));
  return {
    slug: t.academy.slug, name: t.academy.name, plan: st.plan, version: st.course.version,
    rank: { name: st.rank.name, points: st.totals.points },
    rounds: st.rounds.map((r) => {
      const meta = t.meta.find((x) => x.roundNumber === r.round);
      const sections = st.modules.filter((m) => m.round === r.round).map((m) => {
        const mine = lessons.filter((l) => l.module_id === m.id).sort((a, b) => a.position - b.position);
        return {
          id: m.id, number: sectionNumber(m.position), title: m.title, state: m.state, reason: m.reason, doneCount: m.doneCount, itemCount: m.itemCount, done: m.done,
          steps: mine.map((l, li) => ({
            lessonId: l.id, title: l.title,
            // The short lesson: only for a section the learner can open.
            summary: m.state === "locked" ? null : bodies.get(l.id)?.body.summary ?? null,
            items: m.items.filter((it) => it.lessonId === l.id || (li === 0 && !it.lessonId)).map((it) => ({
              kind: it.kind, id: it.id, title: it.title, part: it.part, importanceLabel: it.importance ? IMPORTANCE[it.importance].label : null,
              points: it.points, done: it.done, open: it.open,
            })),
          })),
        };
      });
      return {
        round: r.round, label: meta?.label ?? `Round ${r.round}`, goal: meta?.goal ?? null, state: r.state, reason: r.reason, complete: r.complete,
        doneCount: r.doneCount, itemCount: r.itemCount, sections,
      };
    }),
    note: "Each Round goes deeper into the same 5 sections. Finish every item of a Round to open the next.",
  };
}

const flatten = (b: Body) => [b.summary ?? "", ...(b.sections ?? []).flatMap((s) => [s.heading, ...s.paragraphs.map((p) => p.text)]), ...(b.takeaways ?? []).map((x) => x.text)].filter(Boolean);

/** Every lesson the learner can open in the track, by Round and section. Locked lessons aren't listed with their text. */
export async function trackLibrary(actor: Account, slug: string) {
  const t = await liveTrack(actor, slug);
  if (!t) return null;
  const st = (await courseState(actor, t.live.id))!;
  const open = st.modules.filter((m) => m.state !== "locked");
  const lessons = ((await getDb().from("lessons").select("id, module_id, position, title").in("module_id", open.map((m) => m.id).concat(["00000000-0000-4000-8000-000000000000"]))).data ?? []) as
    { id: string; module_id: string; position: number; title: string }[];
  const bodies = await publishedBodies(lessons.map((l) => l.id));
  const entries = lessons.map((l) => {
    const m = open.find((x) => x.id === l.module_id)!;
    const b = bodies.get(l.id);
    return b ? { round: m.round ?? 1, section: sectionNumber(m.position), sectionTitle: m.title, lessonId: l.id, title: b.title, paragraphs: flatten(b.body), position: m.position * 100 + l.position } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.position - b.position);
  return {
    slug: t.academy.slug, name: t.academy.name,
    entries: entries.map((e) => ({ round: e.round, section: e.section, sectionTitle: e.sectionTitle, lessonId: e.lessonId, title: e.title, paragraphs: e.paragraphs })),
    lockedRounds: st.rounds.filter((r) => r.state === "locked").map((r) => ({ round: r.round, reason: r.reason })),
    note: "Read-only. Lessons in sections you haven't opened yet aren't listed.",
  };
}
