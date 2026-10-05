import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { SYSTEM_ACTOR, recordAudit, type AuditActor } from "@/lib/audit";
import { actorOf } from "@/lib/auth/require-cap";
import { getDb } from "@/lib/db";
import { AiUnavailable, aiConfigured, spendSoFar, structured, webResearch } from "@/lib/ai";
import { AI_MODELS, WEB_SEARCH, estimateUsd, refreshEstimate, spendCaps } from "@/lib/ai/config";
import { quoteIsIn } from "@/lib/sources/text";
import { refetchPage } from "@/lib/sources/library";
import { ATTORNEY, NO_ATTORNEY, clean, isUuid, longestSharedRun, refused, type Result } from "./common";
import { MAX_COPIED_WORDS, type Citation, type LessonBody, type Para } from "./lessons";
import { approvedSources, passagesFor } from "./passages";
import { parseResearch, proposeFindings, type MarketSignal } from "./research";
import { decide } from "@/lib/caps";

/**
 * L3: the freshness cycle. A refresh NEVER changes what learners see by itself:
 *   1. it re-checks every approved source the course cites (still there, changed, gone);
 *   2. it runs a web research pass on what has changed in the field since the course was last verified (Haiku 4.5
 *      with web search): new findings go into the ledger as PROPOSED, with outdated notes and a "market signal"
 *      (plain notes with citations, no predictions);
 *   3. it writes a change report (Sonnet 5.5): lesson paragraphs now doubtful or outdated, and suggested edits, each
 *      citing the evidence it rests on.
 * A Reviewer decides: each approved edit goes into a NEW Draft version of its lesson (the published version is never
 * touched), which then goes through Review and Publish (L2). Closing the report marks the course verified.
 * The nightly job (/api/cron/refresh) runs queued and due courses under the L1 spend caps; when a cap is reached
 * the rest wait for the next night, and the course says why.
 */
export const REFRESH_DEFAULT_DAYS = 42;
export const REFRESH_MIN_DAYS = 30;
export const REFRESH_MAX_DAYS = 60;
const DAY = 86_400_000;

export const REFRESH_SYSTEM = [
  "You check whether a course's field has changed. Search the web for what is new or different since the date given.",
  "Answer in exactly this form and nothing else:",
  "## Changed",
  "- one change per line (a new tool, term or method, or a changed recommendation), in your own words, supported by a search result",
  "## Outdated",
  "- OLD PRACTICE, TOOL OR TERM -> WHAT REPLACED IT: one sentence, supported by a search result",
  "## Pace of change",
  "- one observation per line about how much is changing (new tools, new terms, shifting methods), supported by a search result",
  "- Overall: changing quickly | changing moderately | mostly stable, and why, from what the sources show",
  "Rules: report what the sources say and when; no predictions about the future; up to 10 lines per section;",
  "write \"- None found\" for an empty section. Never describe anything as legally or attorney approved.",
].join("\n");

export const REPORT_SYSTEM = [
  "You review a published course against what has changed in its field.",
  "You get each lesson's paragraphs (with ids like L2.S1.P3 or L2.T1), the results of re-checking its sources, and numbered",
  "evidence (E1, E2, …): new findings from a web search, and passages from the course's approved sources, each with its source.",
  "- List the paragraphs whose claims are now doubtful or outdated (kind: outdated, contradicted or source_problem), with a one-sentence reason.",
  "- For each one the evidence lets you fix, suggest replacement text: in your own words and the lesson's style, changing only what the",
  "  evidence supports, and citing the evidence numbers it rests on. Quote at most a short phrase.",
  "- Suggest nothing for paragraphs that are still accurate. No predictions. Never describe anything as legally or attorney approved.",
].join("\n");

const ReportSchema = z.object({
  doubtful: z.array(z.object({ paragraph: z.string(), kind: z.enum(["outdated", "contradicted", "source_problem"]), reason: z.string() })),
  edits: z.array(z.object({ paragraph: z.string(), newText: z.string(), evidence: z.array(z.number().int()), reason: z.string() })),
});
type Report = z.infer<typeof ReportSchema>;

// ============ Settings, dates and staleness ============

type RefreshRow = {
  id: string; academy_id: string; refresh_days: number; last_verified_at: string | null; queue_status: string; queue_note: string | null;
  queued_at: string | null; last_run_at: string | null;
};
type LiveCourse = { academy: { id: string; slug: string; name: string }; courseId: string; version: number };

async function refreshRow(academyId: string): Promise<RefreshRow> {
  const db = getDb();
  const got = (await db.from("course_refresh").select("*").eq("academy_id", academyId).maybeSingle()).data as RefreshRow | null;
  if (got) return got;
  const ins = await db.from("course_refresh").insert({ academy_id: academyId }).select("*").single();
  if (ins.error?.code === "23505") return (await db.from("course_refresh").select("*").eq("academy_id", academyId).single()).data as RefreshRow;
  if (ins.error) throw new Error(`refresh settings insert failed: ${ins.error.message}`);
  return ins.data as RefreshRow;
}

type PublishedVersion = { id: string; lesson_id: string; version: number; title: string; body: LessonBody; citations: Citation[]; verified_at: string | null; published_at: string; last_verified_on: string | null };

/** The live course version (the latest Published or Restored one) and its published lesson versions. */
async function liveCourse(academyId: string): Promise<{ courseId: string; version: number; lessons: PublishedVersion[] } | null> {
  const db = getDb();
  const courses = ((await db.from("courses").select("id, version, status").eq("academy_id", academyId)).data ?? []) as { id: string; version: number; status: string }[];
  const live = courses.filter((c) => c.status === "published" || c.status === "restored").sort((a, b) => b.version - a.version)[0];
  if (!live) return null;
  const lessons = ((await db.from("lesson_versions").select("id, lesson_id, version, title, body, citations, verified_at, published_at, last_verified_on")
    .eq("course_id", live.id).eq("status", "published")).data ?? []) as PublishedVersion[];
  return { courseId: live.id, version: live.version, lessons };
}

export type Freshness = {
  days: number; lastVerifiedAt: string | null; nextRefreshAt: string | null; due: boolean; status: string; note: string | null;
  queuedAt: string | null; lastRunAt: string | null; staleLessons: string[]; estimateUsd: number;
};

/** A lesson is stale when its refresh date has passed with no review since. */
export function freshnessOf(row: RefreshRow, lessons: { lesson_id: string; verified_at: string | null; published_at: string }[], now = new Date()): Freshness {
  const firstPublished = lessons.map((l) => l.verified_at ?? l.published_at).sort()[0] ?? null;
  const lastVerifiedAt = row.last_verified_at ?? firstPublished;
  const next = lastVerifiedAt ? new Date(new Date(lastVerifiedAt).getTime() + row.refresh_days * DAY) : null;
  const staleLessons = lessons.filter((l) => {
    const checked = [l.verified_at ?? l.published_at, row.last_verified_at].filter((x): x is string => !!x).sort().at(-1)!;
    return now.getTime() > new Date(checked).getTime() + row.refresh_days * DAY;
  }).map((l) => l.lesson_id);
  return {
    days: row.refresh_days, lastVerifiedAt, nextRefreshAt: next?.toISOString() ?? null, due: !!next && now >= next,
    status: row.queue_status, note: row.queue_note, queuedAt: row.queued_at, lastRunAt: row.last_run_at, staleLessons, estimateUsd: refreshEstimate(),
  };
}

/** The settings as stored, or the defaults when the course has none yet (reading never writes). */
async function readRefresh(academyId: string): Promise<RefreshRow> {
  const got = (await getDb().from("course_refresh").select("*").eq("academy_id", academyId).maybeSingle()).data as RefreshRow | null;
  return got ?? { id: "", academy_id: academyId, refresh_days: REFRESH_DEFAULT_DAYS, last_verified_at: null, queue_status: "idle", queue_note: null, queued_at: null, last_run_at: null };
}

export async function courseFreshness(academyId: string, now = new Date()): Promise<Freshness> {
  const row = await readRefresh(academyId);
  const live = await liveCourse(academyId);
  return freshnessOf(row, live?.lessons ?? [], now);
}

const academyBySlug = async (slug: string) =>
  (await getDb().from("academies").select("id, slug, name").eq("slug", slug).maybeSingle()).data as LiveCourse["academy"] | null;

/** Owner only: the refresh interval, 30 to 60 days. Body: { days } (the reason comes with the request). */
export async function setRefreshDays(actor: Account, slug: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.refresh.configure";
  const academy = await academyBySlug(slug);
  if (!academy) return refused(404, "No such course.", A);
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < REFRESH_MIN_DAYS || days > REFRESH_MAX_DAYS) {
    return refused(400, `The refresh interval is ${REFRESH_MIN_DAYS} to ${REFRESH_MAX_DAYS} days.`, A, { type: "course", id: slug, label: academy.name });
  }
  const row = await refreshRow(academy.id);
  const { error } = await getDb().from("course_refresh").update({ refresh_days: days, updated_by_account_id: actor.id }).eq("id", row.id);
  if (error) throw new Error(`refresh setting failed: ${error.message}`);
  return {
    ok: true, body: { days },
    event: { action: A, result: "Completed", target: { type: "course", id: slug, label: academy.name }, previous: `${row.refresh_days} days`, next: `${days} days`, context: `Set ${academy.name}'s refresh interval to ${days} days.` },
  };
}

/** Course Admins (assigned), Reviewers (assigned), Super Admins and the Owner queue a refresh for the next run. */
export async function queueRefresh(actor: Account, slug: string): Promise<Result> {
  const A = "courses.refresh.run";
  const academy = await academyBySlug(slug);
  if (!academy) return refused(404, "No such course.", A);
  const target = { type: "course", id: slug, label: academy.name };
  const principal = { role: actor.roleKey, assignedCourses: actor.assignedCourses };
  if (slug === "gsa" || (!decide(principal, "courses.edit", { course: slug }).allowed && !decide(principal, "courses.review", { course: slug }).allowed)) {
    return refused(403, "You can only work on courses assigned to you.", A, target);
  }
  const live = await liveCourse(academy.id);
  if (!live?.lessons.length) return refused(409, "This course has no published lesson to refresh yet.", A, target);
  const open = (((await getDb().from("refresh_runs").select("id").eq("academy_id", academy.id).in("status", ["running", "ready"]).limit(1)).data ?? []) as { id: string }[])[0];
  if (open) return refused(409, "A change report for this course is waiting for review. Close it first.", A, target);
  const row = await refreshRow(academy.id);
  const estimate = refreshEstimate();
  const { error } = await getDb().from("course_refresh").update({
    queue_status: "queued", queue_note: `Queued by hand; runs with the nightly job (estimated up to $${estimate.toFixed(2)}).`,
    queued_at: new Date().toISOString(), queued_by_account_id: actor.id,
  }).eq("id", row.id);
  if (error) throw new Error(`queue failed: ${error.message}`);
  return {
    ok: true, body: { queued: true, estimateUsd: estimate },
    event: { action: A, result: "Completed", target, previous: row.queue_status, next: "queued", context: `Queued a refresh of ${academy.name} for the next run (estimated up to $${estimate.toFixed(2)}).` },
  };
}

// ============ Source re-checks ============

export type SourceCheck = { sourceId: string; title: string; url: string | null; result: "ok" | "changed" | "gone" | "unreachable"; detail: string };

async function checkSources(sourceIds: string[]): Promise<SourceCheck[]> {
  const db = getDb();
  if (!sourceIds.length) return [];
  const sources = ((await db.from("sources").select("id, title, url, status, storage_path").in("id", sourceIds)).data ?? []) as
    { id: string; title: string; url: string | null; status: string; storage_path: string | null }[];
  const out: SourceCheck[] = [];
  for (const s of sources.filter((x) => x.status === "approved")) {
    if (!s.url) {
      out.push({ sourceId: s.id, title: s.title, url: null, result: "ok", detail: "An uploaded document, kept in storage: nothing to re-check online." });
      continue;
    }
    const page = await refetchPage(s.url);
    if (!page.ok) {
      out.push({ sourceId: s.id, title: s.title, url: s.url, result: page.gone ? "gone" : "unreachable", detail: page.detail });
      continue;
    }
    const chunks = ((await db.from("source_chunks").select("content").eq("source_id", s.id).limit(10)).data ?? []) as { content: string }[];
    const probes = chunks.map((c) => c.content.replace(/…$/, "").slice(0, 160)).filter((c) => c.length >= 20);
    const missing = probes.filter((p) => !quoteIsIn(p, page.text)).length;
    if (probes.length && missing * 2 > probes.length) {
      out.push({ sourceId: s.id, title: s.title, url: s.url, result: "changed", detail: `${missing} of ${probes.length} passages the course relies on are no longer on the page.` });
    } else {
      out.push({ sourceId: s.id, title: s.title, url: s.url, result: "ok", detail: probes.length ? "Still there; the passages the course relies on are on the page." : "Still there." });
      await db.from("sources").update({ last_checked_at: new Date().toISOString() }).eq("id", s.id);
    }
  }
  return out;
}

// ============ The change report ============

type Loc = { lessonIndex: number; key: string; version: PublishedVersion; para: Para };

/** Every paragraph of the published lessons, with an id the model can point at: L2.S1.P3 or L2.T1. */
export function paragraphsOf(versions: PublishedVersion[]): Map<string, Loc> {
  const out = new Map<string, Loc>();
  versions.forEach((v, li) => {
    v.body.sections.forEach((s, si) => s.paragraphs.forEach((p, pi) => out.set(`L${li + 1}.S${si + 1}.P${pi + 1}`, { lessonIndex: li, key: `S${si + 1}.P${pi + 1}`, version: v, para: p })));
    v.body.takeaways.forEach((t, ti) => out.set(`L${li + 1}.T${ti + 1}`, { lessonIndex: li, key: `T${ti + 1}`, version: v, para: t }));
  });
  return out;
}

type Evidence = { n: number; sourceId: string; title: string; url: string | null; text: string };
type Doubt = { lessonId: string; lessonTitle: string; versionId: string; paragraph: string; text: string; kind: string; reason: string };

/** Checks the model's answer against the lessons and evidence: unknown paragraphs and uncited or copied edits are dropped. Pure. */
export function vetReport(report: Report, paras: Map<string, Loc>, evidence: Evidence[]) {
  const byN = new Map(evidence.map((e) => [e.n, e]));
  const doubtful: Doubt[] = report.doubtful.filter((d) => paras.has(d.paragraph) && !ATTORNEY.test(d.reason)).slice(0, 40).map((d) => {
    const loc = paras.get(d.paragraph)!;
    return { lessonId: loc.version.lesson_id, lessonTitle: loc.version.title, versionId: loc.version.id, paragraph: loc.key, text: loc.para.text.slice(0, 600), kind: d.kind, reason: clean(d.reason, 300) };
  });
  const seen = new Set<string>();
  const edits = report.edits.flatMap((e) => {
    const loc = paras.get(e.paragraph);
    const used = [...new Set(e.evidence)].map((n) => byN.get(n)).filter((x): x is Evidence => !!x);
    const text = clean(e.newText, 2000);
    if (!loc || !used.length || !text || ATTORNEY.test(text) || seen.has(e.paragraph)) return [];
    if (Math.max(0, ...used.map((u) => longestSharedRun(text, u.text))) > MAX_COPIED_WORDS) return [];
    seen.add(e.paragraph);
    const sources = [...new Map(used.map((u) => [u.sourceId, { sourceId: u.sourceId, title: u.title, url: u.url }])).values()];
    return [{ lesson_id: loc.version.lesson_id, base_version_id: loc.version.id, location: loc.key, old_text: loc.para.text, new_text: text, sources, reason: clean(e.reason, 500) || "Updated from newer sources." }];
  }).slice(0, 30);
  return { doubtful, edits };
}

type RunOutcome = { status: "ready" | "skipped" | "waiting_cap" | "failed"; runId?: string; note: string; costUsd: number };

/** One course's refresh. `actor` is null for the scheduled job. */
export async function runRefresh(academy: LiveCourse["academy"], trigger: "scheduled" | "manual", actor: Account | null): Promise<RunOutcome> {
  const db = getDb();
  const audit: AuditActor = actor ? actorOf(actor) : SYSTEM_ACTOR("scheduled refresh");
  const row = await refreshRow(academy.id);
  const live = await liveCourse(academy.id);
  if (!live?.lessons.length) {
    await db.from("course_refresh").update({ queue_status: "idle", queue_note: "Nothing to refresh: no published lesson." }).eq("id", row.id);
    return { status: "skipped", note: "no published lesson", costUsd: 0 };
  }
  const fresh = freshnessOf(row, live.lessons);
  const ins = await db.from("refresh_runs").insert({
    academy_id: academy.id, course_id: live.courseId, trigger, status: "running", since: fresh.lastVerifiedAt, started_by_account_id: actor?.id ?? null,
  }).select("id").single();
  if (ins.error?.code === "23505") {
    await db.from("course_refresh").update({ queue_status: "idle", queue_note: "A change report is waiting for review; no new run until it is closed." }).eq("id", row.id);
    return { status: "skipped", note: "a report is waiting for review", costUsd: 0 };
  }
  if (ins.error) throw new Error(`refresh run insert failed: ${ins.error.message}`);
  const runId = (ins.data as { id: string }).id;
  await db.from("course_refresh").update({ queue_status: "running", queue_note: null }).eq("id", row.id);

  let cost = 0;
  try {
    // 1. Re-check every approved source the course cites or was built from.
    const bp = (((await db.from("academy_blueprints").select("topic, audience_level, source_ids, status").eq("course_id", live.courseId).limit(1)).data ?? []) as
      { topic: string; audience_level: string; source_ids: string[] }[])[0];
    const cited = live.lessons.flatMap((l) => l.citations.map((c) => c.sourceId));
    const checks = await checkSources([...new Set([...cited, ...(bp?.source_ids ?? [])])]);
    const troubled = new Map(checks.filter((c) => c.result === "gone" || c.result === "changed").map((c) => [c.sourceId, c]));
    const paras = paragraphsOf(live.lessons);
    const sourceDoubts: Doubt[] = [...paras.values()].flatMap((loc) => {
      const bad = loc.para.refs.map((r) => loc.version.citations.find((c) => c.ref === r)?.sourceId).map((id) => (id ? troubled.get(id) : undefined)).find((x) => !!x);
      return bad ? [{ lessonId: loc.version.lesson_id, lessonTitle: loc.version.title, versionId: loc.version.id, paragraph: loc.key, text: loc.para.text.slice(0, 600),
        kind: "source_problem", reason: `Its source "${bad.title}" is ${bad.result === "gone" ? "gone" : "changed"}: ${bad.detail}` }] : [];
    });

    if (!aiConfigured()) {
      await finish(runId, row.id, { source_checks: checks, doubtful: sourceDoubts, error: "AI is off (ANTHROPIC_API_KEY isn't set): sources were re-checked; no research pass or suggested edits." }, 0);
      await recordAudit({ actor: audit, action: "courses.refresh.run", result: "Completed", target: { type: "course", id: academy.slug, label: academy.name },
        next: "change report ready", context: `Refreshed ${academy.name}: sources re-checked only (AI is off). ${troubled.size} source(s) gone or changed.` });
      return { status: "ready", runId, note: "AI is off: sources re-checked only", costUsd: 0 };
    }

    // 2. What has changed in the field since the last verification (new findings are PROPOSED).
    const since = (fresh.lastVerifiedAt ?? new Date().toISOString()).slice(0, 10);
    const topic = bp?.topic ?? academy.name;
    const audience = bp?.audience_level ?? "beginner";
    const freshness = `What has changed in this field since ${since}: new tools, new terms, new methods, and things now outdated?`;
    const research = await webResearch({
      purpose: "courses.refresh.research", system: REFRESH_SYSTEM, user: `Topic: ${topic}\nAudience level: ${audience}\nLast verified: ${since}\nQuestion: ${freshness}`,
      maxUses: WEB_SEARCH.maxUses, estimateUsd: estimateUsd("refreshResearch"), accountId: actor?.id ?? null,
    });
    cost += research.costUsd;
    const parsed = parseResearch(research.content);
    const rr = await db.from("research_runs").insert({
      topic, audience_level: audience, freshness_question: freshness, status: "completed", model: AI_MODELS["courses.refresh.research"],
      search_count: research.searches, outdated_notes: parsed.outdated, cost_usd: research.costUsd, created_by_account_id: actor?.id ?? null, refresh_run_id: runId,
    }).select("id").single();
    if (rr.error) throw new Error(`refresh research insert failed: ${rr.error.message}`);
    const researchRunId = (rr.data as { id: string }).id;
    const proposed = await proposeFindings(parsed, researchRunId, actor?.id ?? null);

    // 3. The change report: doubtful paragraphs and cited suggested edits.
    const newSources = proposed.sourceIdByUrl.size ? (((await db.from("sources").select("id, title, url").in("id", [...proposed.sourceIdByUrl.values()])).data ?? []) as { id: string; title: string; url: string | null }[]) : [];
    const evidence: Evidence[] = [];
    for (const f of parsed.findings) {
      const c = f.citations.find((x) => proposed.sourceIdByUrl.has(x.url));
      const s = c ? newSources.find((x) => x.id === proposed.sourceIdByUrl.get(c.url)) : undefined;
      if (c && s) evidence.push({ n: evidence.length + 1, sourceId: s.id, title: s.title, url: s.url, text: `${f.text} (quoted: "${c.citedText}")` });
    }
    const courseSources = await approvedSources([...new Set([...cited, ...(bp?.source_ids ?? [])])]);
    for (const p of (await passagesFor(courseSources)).slice(0, 40)) {
      const s = courseSources.find((x) => x.id === p.sourceId)!;
      evidence.push({ n: evidence.length + 1, sourceId: s.id, title: s.title, url: s.url, text: p.text });
    }
    const lessonsText = live.lessons.map((v, li) => [
      `Lesson L${li + 1}: ${v.title}`,
      ...[...paras].filter(([, loc]) => loc.lessonIndex === li).map(([id, loc]) => `${id}: ${loc.para.text}`),
    ].join("\n")).join("\n\n");
    const checkText = checks.map((c) => `- ${c.title}: ${c.result}${c.result === "ok" ? "" : ` (${c.detail})`}`).join("\n");
    const outdatedText = parsed.outdated.map((o) => `- ${o.item}${o.replacedBy ? ` -> ${o.replacedBy}` : ""}`).join("\n");
    const report = await structured("courses.refresh.report", {
      system: REPORT_SYSTEM,
      user: [`Course: ${academy.name} (${audience})`, `Last verified: ${since}`, "", lessonsText, "", `Source re-checks:\n${checkText || "- none"}`,
        outdatedText ? `\nOutdated, according to the new research:\n${outdatedText}` : "",
        "", "Evidence:", ...evidence.map((e) => `E${e.n} [${e.title}]: ${e.text}`)].join("\n"),
      schema: ReportSchema, maxTokens: 16_000, timeoutMs: 240_000, estimateUsd: estimateUsd("refreshReport"), accountId: actor?.id ?? null,
    });
    const vetted = vetReport(report, paras, evidence);
    // The report's cost isn't returned by structured(); read it back from the call log.
    const lastCall = (((await db.from("ai_calls").select("cost_usd").eq("purpose", "courses.refresh.report").order("created_at", { ascending: false }).limit(1)).data ?? []) as { cost_usd: number | string }[])[0];
    cost += Number(lastCall?.cost_usd ?? 0);
    if (vetted.edits.length) {
      const { error } = await db.from("refresh_edits").insert(vetted.edits.map((e) => ({ ...e, refresh_run_id: runId })));
      if (error) throw new Error(`refresh edits insert failed: ${error.message}`);
    }
    const doubtful = [...sourceDoubts, ...vetted.doubtful.filter((d) => !sourceDoubts.some((s) => s.versionId === d.versionId && s.paragraph === d.paragraph))];
    await finish(runId, row.id, {
      source_checks: checks, research_run_id: researchRunId, new_source_ids: proposed.newSourceIds, market_signal: parsed.signal, doubtful,
    }, cost);
    await recordAudit({
      actor: audit, action: "courses.refresh.run", result: "Completed", target: { type: "course", id: academy.slug, label: academy.name }, next: "change report ready",
      context: `Refreshed ${academy.name} (${trigger}): ${checks.length} source(s) re-checked (${troubled.size} gone or changed), ${proposed.newSourceIds.length} new proposed source(s), ${doubtful.length} doubtful paragraph(s), ${vetted.edits.length} suggested edit(s); $${cost.toFixed(4)}. Nothing changes for learners until a Reviewer approves edits and a new version is published.`,
    });
    return { status: "ready", runId, note: `${vetted.edits.length} suggested edit(s)`, costUsd: cost };
  } catch (err) {
    const capped = err instanceof AiUnavailable && err.code === "cap_reached";
    const msg = err instanceof Error ? err.message : String(err);
    await db.from("refresh_runs").update({ status: "failed", error: msg.slice(0, 1000), finished_at: new Date().toISOString(), cost_usd: cost }).eq("id", runId);
    await db.from("course_refresh").update({
      queue_status: capped ? "waiting_cap" : "failed",
      queue_note: capped ? `Waiting for the next nightly run: ${msg}` : `The last refresh failed: ${msg.slice(0, 300)} It will be tried again on the next run.`,
      last_run_at: new Date().toISOString(),
    }).eq("id", row.id);
    await recordAudit({ actor: audit, action: "courses.refresh.run", result: "Blocked", status: capped ? "Waiting for the spend cap" : "Failed",
      target: { type: "course", id: academy.slug, label: academy.name }, context: `Refresh of ${academy.name} stopped: ${msg.slice(0, 300)}` });
    if (!(err instanceof AiUnavailable)) console.error("[refresh] failed:", msg);
    return { status: capped ? "waiting_cap" : "failed", runId, note: msg, costUsd: cost };
  }
}

async function finish(runId: string, refreshId: string, fields: Record<string, unknown>, cost: number) {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db.from("refresh_runs").update({ ...fields, status: "ready", cost_usd: Math.round(cost * 1_000_000) / 1_000_000, finished_at: now }).eq("id", runId);
  if (error) throw new Error(`refresh report save failed: ${error.message}`);
  await db.from("course_refresh").update({ queue_status: "idle", queue_note: null, queued_at: null, last_run_at: now }).eq("id", refreshId);
}

// ============ The nightly queue ============

/**
 * Runs queued courses first, then those past their refresh date, starting new ones only within the time budget. Each run is checked
 * against the spend caps first: once a cap would be passed, the remaining courses wait for the next night and say why.
 */
export async function runRefreshQueue(opts: { budgetMs?: number; now?: Date } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 60_000;
  const now = opts.now ?? new Date();
  const db = getDb();
  // A run cut off by the platform's time limit would otherwise stay "running" and block its course: mark it failed.
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  const stuck = ((await db.from("refresh_runs").select("id, academy_id").eq("status", "running").lt("started_at", cutoff)).data ?? []) as { id: string; academy_id: string }[];
  for (const r of stuck) {
    await db.from("refresh_runs").update({ status: "failed", error: "Stopped before it finished (time limit). It will run again.", finished_at: now.toISOString() }).eq("id", r.id);
    await db.from("course_refresh").update({ queue_status: "queued", queue_note: "The last run stopped before it finished; it will run again." }).eq("academy_id", r.academy_id);
  }
  const academies = ((await db.from("academies").select("id, slug, name")).data ?? []) as LiveCourse["academy"][];
  const candidates: { academy: LiveCourse["academy"]; row: RefreshRow; order: number }[] = [];
  for (const a of academies.filter((x) => x.slug !== "gsa")) {
    const live = await liveCourse(a.id);
    if (!live?.lessons.length) continue;
    const row = await refreshRow(a.id);
    const f = freshnessOf(row, live.lessons, now);
    const open = (((await db.from("refresh_runs").select("id").eq("academy_id", a.id).in("status", ["running", "ready"]).limit(1)).data ?? []) as { id: string }[])[0];
    if (open) continue;
    if (row.queue_status === "queued" || row.queue_status === "waiting_cap") candidates.push({ academy: a, row, order: 0 });
    else if (f.due) candidates.push({ academy: a, row, order: 1 });
  }
  candidates.sort((x, y) => x.order - y.order || String(x.row.queued_at ?? "").localeCompare(String(y.row.queued_at ?? "")));
  const results: { course: string; status: string; note: string }[] = [];
  for (const [i, c] of candidates.entries()) {
    if (Date.now() - started > budget) {
      for (const rest of candidates.slice(i)) {
        await db.from("course_refresh").update({ queue_status: "queued", queue_note: "Waiting for the next nightly run: tonight's run time was used up." }).eq("id", rest.row.id);
        results.push({ course: rest.academy.slug, status: "queued", note: "out of time; next run" });
      }
      break;
    }
    if (aiConfigured()) {
      const caps = spendCaps();
      const spent = await spendSoFar();
      const est = refreshEstimate();
      if (spent.day + est > caps.perDay || spent.month + est > caps.perMonth) {
        const why = spent.day + est > caps.perDay
          ? `today's AI spend cap ($${spent.day.toFixed(2)} of $${caps.perDay} used; a refresh is estimated at up to $${est.toFixed(2)})`
          : `this month's AI spend cap ($${spent.month.toFixed(2)} of $${caps.perMonth} used; a refresh is estimated at up to $${est.toFixed(2)})`;
        for (const rest of candidates.slice(i)) {
          await db.from("course_refresh").update({ queue_status: "waiting_cap", queue_note: `Waiting for the next nightly run: ${why}.` }).eq("id", rest.row.id);
          results.push({ course: rest.academy.slug, status: "waiting_cap", note: why });
        }
        break;
      }
    }
    const r = await runRefresh(c.academy, c.row.queue_status === "queued" ? "manual" : "scheduled", null);
    results.push({ course: c.academy.slug, status: r.status, note: r.note });
  }
  return { checked: academies.length, ran: results.filter((r) => r.status === "ready").length, results };
}

// ============ The Reviewer's decisions ============

type EditRow = {
  id: string; refresh_run_id: string; lesson_id: string; base_version_id: string; location: string; old_text: string; new_text: string;
  sources: { sourceId: string; title: string; url: string | null }[]; reason: string; status: string;
};

/** Applies the approved edits to a copy of the published body. Pure. */
export function applyEdits(base: { body: LessonBody; citations: Citation[] }, edits: Pick<EditRow, "location" | "new_text" | "sources">[], sourceInfo: Map<string, { title: string; url: string | null; license: string; lastChecked: string | null }>) {
  const body: LessonBody = structuredClone(base.body);
  const citations: Citation[] = base.citations.map((c) => ({ ...c, ...(sourceInfo.has(c.sourceId) ? { lastChecked: sourceInfo.get(c.sourceId)!.lastChecked } : {}) }));
  const refFor = (sourceId: string) => {
    let c = citations.find((x) => x.sourceId === sourceId);
    if (!c) {
      const s = sourceInfo.get(sourceId);
      c = { ref: citations.length + 1, sourceId, title: s?.title ?? "Source", url: s?.url ?? null, license: s?.license ?? "web_summarize_only", lastChecked: s?.lastChecked ?? null };
      citations.push(c);
    }
    return c.ref;
  };
  for (const e of edits) {
    const m = /^S(\d+)\.P(\d+)$/.exec(e.location);
    const t = /^T(\d+)$/.exec(e.location);
    const target = m ? body.sections[Number(m[1]) - 1]?.paragraphs[Number(m[2]) - 1] : t ? body.takeaways[Number(t[1]) - 1] : undefined;
    if (!target) continue;
    target.text = e.new_text;
    target.refs = [...new Set(e.sources.map((s) => refFor(s.sourceId)))].sort((a, b) => a - b);
  }
  // Keep only the citations the lesson still uses, renumbered in order of first use.
  const used = [...new Set([...body.sections.flatMap((s) => s.paragraphs), ...body.takeaways].flatMap((p) => p.refs))];
  const renumber = new Map(used.map((r, i) => [r, i + 1]));
  for (const p of [...body.sections.flatMap((s) => s.paragraphs), ...body.takeaways]) p.refs = p.refs.map((r) => renumber.get(r)!).sort((a, b) => a - b);
  const kept = citations.filter((c) => renumber.has(c.ref)).map((c) => ({ ...c, ref: renumber.get(c.ref)! })).sort((a, b) => a.ref - b.ref);
  const uncited = [...body.sections.flatMap((s) => s.paragraphs), ...body.takeaways].filter((p) => !p.refs.length).length;
  const dates = kept.map((c) => c.lastChecked).filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { body, citations: kept, uncited, lastVerifiedOn: dates[0] ?? null };
}

async function runInCourse(slug: string, runId: string) {
  const academy = await academyBySlug(slug);
  if (!academy || !isUuid(runId)) return null;
  const run = (await getDb().from("refresh_runs").select("*").eq("id", runId).maybeSingle()).data as { id: string; academy_id: string; status: string } | null;
  return run && run.academy_id === academy.id ? { academy, run } : null;
}

/**
 * A Reviewer approves or rejects a suggested edit. Approving puts it (with the other approved edits of the same
 * report) into a NEW Draft version of the lesson; the published version is never changed. Body: { decision, note? }.
 */
export async function decideEdit(actor: Account, slug: string, editId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.refresh.edit";
  if (!isUuid(editId)) return refused(404, "No such suggested edit.", A);
  const db = getDb();
  const edit = (await db.from("refresh_edits").select("*").eq("id", editId).maybeSingle()).data as EditRow | null;
  const found = edit ? await runInCourse(slug, edit.refresh_run_id) : null;
  if (!edit || !found) return refused(404, "No such suggested edit in this course.", A);
  const target = { type: "refresh_edit", id: editId, label: edit.location };
  if (decide({ role: actor.roleKey, assignedCourses: actor.assignedCourses }, "courses.review", { course: slug }).allowed === false) {
    return refused(403, "You can only work on courses assigned to you.", A, target);
  }
  if (body.decision !== "approve" && body.decision !== "reject") return refused(400, "Choose approve or reject.", A, target);
  if (edit.status !== "suggested") return refused(409, `This edit was already ${edit.status}.`, A, target);
  if (found.run.status !== "ready") return refused(409, "This change report is closed.", A, target);
  const now = new Date().toISOString();
  if (body.decision === "reject") {
    await db.from("refresh_edits").update({ status: "rejected", decided_by_account_id: actor.id, decided_at: now }).eq("id", editId);
    return { ok: true, body: { id: editId, status: "rejected" }, event: { action: A, result: "Completed", target, previous: "suggested", next: "rejected", context: `Rejected a suggested edit (${edit.location}): ${edit.reason}` } };
  }

  // The published version the edit was written against must still be the one learners see.
  const versions = ((await db.from("lesson_versions").select("id, version, status, refresh_run_id, body, citations, title, course_id").eq("lesson_id", edit.lesson_id)).data ?? []) as
    { id: string; version: number; status: string; refresh_run_id: string | null; body: LessonBody; citations: Citation[]; title: string; course_id: string }[];
  const published = versions.find((v) => v.status === "published");
  if (!published || published.id !== edit.base_version_id) return refused(409, "This lesson was republished since the report; run a new refresh.", A, target);
  const open = versions.find((v) => v.status === "draft" || v.status === "review");
  if (open && !(open.status === "draft" && open.refresh_run_id === edit.refresh_run_id)) {
    return refused(409, open.status === "review"
      ? "This report's draft of the lesson is already in Review. Return it to Draft to add more edits."
      : "This lesson has another open Draft. Finish or return it first.", A, target);
  }

  const { error: decErr } = await db.from("refresh_edits").update({ status: "approved", decided_by_account_id: actor.id, decided_at: now }).eq("id", editId);
  if (decErr) throw new Error(`edit decision failed: ${decErr.message}`);
  const approved = ((await db.from("refresh_edits").select("*").eq("refresh_run_id", edit.refresh_run_id).eq("lesson_id", edit.lesson_id).eq("status", "approved")).data ?? []) as EditRow[];
  const ids = [...new Set([...published.citations.map((c) => c.sourceId), ...approved.flatMap((e) => e.sources.map((s) => s.sourceId))])];
  const info = new Map((((await db.from("sources").select("id, title, url, license_class, last_checked_at, approved_at").in("id", ids)).data ?? []) as
    { id: string; title: string; url: string | null; license_class: string; last_checked_at: string | null; approved_at: string | null }[])
    .map((s) => [s.id, { title: s.title, url: s.url, license: s.license_class, lastChecked: (s.last_checked_at ?? s.approved_at)?.slice(0, 10) ?? null }]));
  const out = applyEdits(published, approved, info);
  const summary = `Updated: ${approved.map((e) => e.reason.replace(/\.$/, "")).join("; ")}.`.slice(0, 500);
  let draftId: string;
  if (open) {
    const { error } = await db.from("lesson_versions").update({ body: out.body, citations: out.citations, uncited_count: out.uncited, last_verified_on: out.lastVerifiedOn, change_summary: summary }).eq("id", open.id);
    if (error) throw new Error(`refresh draft update failed: ${error.message}`);
    draftId = open.id;
  } else {
    const version = Math.max(...versions.map((v) => v.version)) + 1;
    const { data, error } = await db.from("lesson_versions").insert({
      lesson_id: edit.lesson_id, course_id: published.course_id, version, status: "draft", title: published.title, body: out.body, citations: out.citations,
      uncited_count: out.uncited, last_verified_on: out.lastVerifiedOn, generated_by: "ai", model: AI_MODELS["courses.refresh.report"],
      created_by_account_id: actor.id, refresh_run_id: edit.refresh_run_id, change_summary: summary, checks: { fromRefresh: true },
    }).select("id").single();
    if (error) throw new Error(`refresh draft insert failed: ${error.message}`);
    draftId = (data as { id: string }).id;
  }
  await db.from("refresh_edits").update({ draft_version_id: draftId }).eq("id", editId);
  return {
    ok: true, body: { id: editId, status: "approved", draftVersionId: draftId },
    event: {
      action: A, result: "Completed", target, previous: "suggested", next: "approved",
      context: `Approved a suggested edit (${edit.location}) and put it into a Draft of "${published.title}" (${approved.length} approved edit(s)). Learners keep the published version until the Draft is reviewed and published.`,
    },
  };
}

/** Closing a change report marks the course verified (its refresh clock restarts). Body: { note }. */
export async function closeReport(actor: Account, slug: string, runId: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.refresh.review";
  const found = await runInCourse(slug, runId);
  if (!found) return refused(404, "No such change report in this course.", A);
  const target = { type: "refresh_run", id: runId, label: found.academy.name };
  if (!decide({ role: actor.roleKey, assignedCourses: actor.assignedCourses }, "courses.review", { course: slug }).allowed) {
    return refused(403, "You can only work on courses assigned to you.", A, target);
  }
  const note = clean(body.note, 1000);
  if (note.length < 5) return refused(400, "Say what you reviewed (for example: edits approved, the rest still accurate).", A, target);
  if (ATTORNEY.test(note)) return refused(400, NO_ATTORNEY, A, target);
  if (found.run.status !== "ready") return refused(409, `This report is ${found.run.status}.`, A, target);
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db.from("refresh_runs").update({ status: "reviewed", reviewed_by_account_id: actor.id, reviewed_at: now, review_note: note }).eq("id", runId);
  if (error) throw new Error(`report close failed: ${error.message}`);
  const row = await refreshRow(found.academy.id);
  await db.from("course_refresh").update({ last_verified_at: now, queue_status: "idle", queue_note: null }).eq("id", row.id);
  return {
    ok: true, body: { id: runId, status: "reviewed", lastVerifiedAt: now },
    event: { action: A, result: "Completed", target, previous: "ready", next: "reviewed", context: `Closed the change report for ${found.academy.name}: ${note}. The course is verified as of today.` },
  };
}

/** The change reports of a course, newest first, with their suggested edits and the status of every source they cite. */
export async function refreshReports(academyId: string) {
  const db = getDb();
  const runs = ((await db.from("refresh_runs").select("*").eq("academy_id", academyId).order("started_at", { ascending: false }).limit(10)).data ?? []) as {
    id: string; trigger: string; status: string; since: string | null; source_checks: SourceCheck[]; new_source_ids: string[]; market_signal: Partial<MarketSignal>;
    doubtful: Doubt[]; cost_usd: number | string; error: string | null; started_at: string; finished_at: string | null; reviewed_at: string | null; review_note: string | null;
  }[];
  const ids = runs.map((r) => r.id);
  const edits = ids.length ? (((await db.from("refresh_edits").select("*").in("refresh_run_id", ids).order("created_at", { ascending: true })).data ?? []) as (EditRow & { draft_version_id: string | null })[]) : [];
  const srcIds = [...new Set([...runs.flatMap((r) => r.new_source_ids ?? []), ...edits.flatMap((e) => e.sources.map((s) => s.sourceId))])].filter(isUuid);
  const sources = srcIds.length ? (((await db.from("sources").select("id, title, url, status, page_age").in("id", srcIds)).data ?? []) as { id: string; title: string; url: string | null; status: string; page_age: string | null }[]) : [];
  const lessonIds = [...new Set(edits.map((e) => e.lesson_id))];
  const lessons = lessonIds.length ? (((await db.from("lessons").select("id, title").in("id", lessonIds)).data ?? []) as { id: string; title: string }[]) : [];
  const src = (id: string) => sources.find((s) => s.id === id);
  return runs.map((r) => ({
    id: r.id, trigger: r.trigger, status: r.status, since: r.since, startedAt: r.started_at, finishedAt: r.finished_at, reviewedAt: r.reviewed_at, reviewNote: r.review_note,
    costUsd: Number(r.cost_usd), error: r.error, sourceChecks: r.source_checks ?? [],
    newSources: (r.new_source_ids ?? []).map((id) => src(id)).filter((s) => !!s).map((s) => ({ id: s!.id, title: s!.title, url: s!.url, status: s!.status, pageAge: s!.page_age })),
    marketSignal: { pace: r.market_signal?.pace ?? "unclear", notes: r.market_signal?.notes ?? [] },
    doubtful: r.doubtful ?? [],
    edits: edits.filter((e) => e.refresh_run_id === r.id).map((e) => ({
      id: e.id, lessonId: e.lesson_id, lessonTitle: lessons.find((l) => l.id === e.lesson_id)?.title ?? "Lesson", location: e.location, oldText: e.old_text, newText: e.new_text,
      reason: e.reason, status: e.status, draftVersionId: e.draft_version_id,
      sources: e.sources.map((s) => ({ ...s, status: src(s.sourceId)?.status ?? "unknown" })),
    })),
  }));
}
