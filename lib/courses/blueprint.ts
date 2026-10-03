import "server-only";
import { z } from "zod";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AiUnavailable, assertPromptSafe, structured } from "@/lib/ai";
import { AI_MODELS, estimateUsd } from "@/lib/ai/config";
import { ATTORNEY, NO_ATTORNEY, SLUG, clean, courseScope, isAudience, isUuid, refused, type Result } from "./common";
import { approvedSources, passagesFor, renderContext, type Passage } from "./passages";
import type { OutdatedNote } from "./research";

/**
 * L2 step 2: the Blueprint. From APPROVED sources only, Claude (Sonnet 5.5) proposes modules, lessons and skills;
 * each lesson's key claims point at numbered passages, which the server turns back into citations (source, claim,
 * quoted words). A key claim no passage supports is kept and marked as having no source. The outdated notes from the
 * research go with it, for the Reviewer. A person edits or approves the Blueprint before any lesson is written;
 * approving it creates a Draft course version (one transaction, in the database).
 */
const MAX_SOURCES = 15;

export const BLUEPRINT_SYSTEM = [
  "You plan a course outline for a learning platform, from approved, cited source passages only.",
  "- Propose 2 to 6 modules, each with 2 to 5 lessons and the skills the module builds.",
  "- For each lesson: a title, an estimated length in minutes (5 to 30), 2 to 4 learning objectives, and 2 to 5 key claims it will teach.",
  "- Support each key claim with the numbers of the passages that say it. If a claim you consider essential isn't supported by any passage,",
  "  include it with an empty list: it will be marked as having no source.",
  "- Don't teach practices the research lists as outdated, except to say what replaced them.",
  "- Use only what the passages say. Don't call the outline the best or definitive.",
  "- Never describe anything as legally or attorney approved.",
].join("\n");

const BlueprintSchema = z.object({
  title: z.string(),
  outcome: z.string(),
  modules: z.array(z.object({
    title: z.string(),
    stage: z.string(),
    lessons: z.array(z.object({
      title: z.string(),
      minutes: z.number().int(),
      objectives: z.array(z.string()),
      keyClaims: z.array(z.object({ claim: z.string(), passages: z.array(z.number().int()) })),
    })),
    skills: z.array(z.object({ name: z.string() })),
  })),
});
type Generated = z.infer<typeof BlueprintSchema>;

export type KeyClaim = { claim: string; sourceId: string | null; claimId?: string | null; quote?: string | null };
export type Plan = {
  title: string; outcome: string;
  modules: { title: string; stage: string | null; lessons: { title: string; minutes: number | null; objectives: string[]; keyClaims: KeyClaim[] }[]; skills: { key: string; name: string }[] }[];
};

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "skill";

/** Turns the model's answer into a plan whose citations point at real sources. Pure: tested on its own. */
export function toPlan(g: Generated, passages: Passage[]): Plan {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const keys = new Set<string>();
  return {
    title: clean(g.title, 200), outcome: clean(g.outcome, 500),
    modules: g.modules.slice(0, 6).map((m) => ({
      title: clean(m.title, 200), stage: clean(m.stage, 60) || null,
      lessons: m.lessons.slice(0, 6).map((l) => ({
        title: clean(l.title, 200),
        minutes: Number.isInteger(l.minutes) ? Math.min(60, Math.max(3, l.minutes)) : null,
        objectives: l.objectives.map((o) => clean(o, 300)).filter(Boolean).slice(0, 6),
        keyClaims: l.keyClaims.filter((c) => c.claim.trim() && !ATTORNEY.test(c.claim)).slice(0, 8).map((c): KeyClaim => {
          const p = c.passages.map((n) => byN.get(n)).find((x): x is Passage => !!x);
          return p ? { claim: clean(c.claim, 400), sourceId: p.sourceId, claimId: p.claimId, quote: p.quote } : { claim: clean(c.claim, 400), sourceId: null };
        }),
      })).filter((l) => l.title),
      skills: m.skills.map((s) => clean(s.name, 120)).filter(Boolean).slice(0, 6).map((name) => {
        let key = slugify(name);
        for (let i = 2; keys.has(key); i++) key = `${slugify(name).slice(0, 36)}-${i}`;
        keys.add(key);
        return { key, name };
      }),
    })).filter((m) => m.title && m.lessons.length),
  };
}

const lessonCount = (p: Plan) => p.modules.reduce((n, m) => n + m.lessons.length, 0);
const uncitedCount = (p: Plan) => p.modules.reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.keyClaims.filter((c) => !c.sourceId).length, 0), 0);

async function outdatedNotes(runIds: string[]): Promise<OutdatedNote[]> {
  if (!runIds.length) return [];
  const runs = ((await getDb().from("research_runs").select("id, outdated_notes").in("id", runIds)).data ?? []) as { outdated_notes: OutdatedNote[] }[];
  const seen = new Set<string>();
  return runs.flatMap((r) => r.outdated_notes ?? []).filter((n) => {
    const k = n.item.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  }).slice(0, 20);
}

/** Body: { title, topic, audience, sourceIds: [], researchRunIds?: [] }. */
export async function generateBlueprint(actor: Account, slug: string, body: Record<string, unknown>, requestId?: string): Promise<Result> {
  const A = "courses.blueprint.generate";
  const title = clean(body.title, 200);
  const topic = clean(body.topic, 200);
  const sourceIds = Array.isArray(body.sourceIds) ? [...new Set(body.sourceIds.filter(isUuid))] : [];
  const runIds = Array.isArray(body.researchRunIds) ? [...new Set(body.researchRunIds.filter(isUuid))] : [];
  if (!SLUG.test(slug)) return refused(400, "The course id is 2 to 40 lowercase letters, numbers or dashes.", A);
  if (title.length < 3 || topic.length < 3) return refused(400, "Give the course a title and a topic.", A);
  if (!isAudience(body.audience)) return refused(400, "Choose the audience level: beginner, intermediate or advanced.", A);
  if (ATTORNEY.test(title) || ATTORNEY.test(topic)) return refused(400, NO_ATTORNEY, A);
  try {
    assertPromptSafe(title, topic);
  } catch (err) {
    if (err instanceof AiUnavailable) return refused(400, err.message, A);
    throw err;
  }
  const scope = courseScope(actor, "courses.edit", slug);
  if (scope) return refused(403, scope, A, { type: "course", id: slug, label: slug });
  if (!sourceIds.length) return refused(400, "Choose the approved sources the course is built from.", A);
  if (sourceIds.length > MAX_SOURCES) return refused(400, `Choose at most ${MAX_SOURCES} sources.`, A);

  const sources = await approvedSources(sourceIds);
  if (sources.length !== sourceIds.length) return refused(409, "Only approved sources can be used. One or more of those isn't approved (any more).", A);
  const passages = await passagesFor(sources);
  if (!passages.length) return refused(422, "Those sources have no passages to work from yet.", A);
  const notes = await outdatedNotes([...new Set([...runIds, ...sources.map((s) => s.researchRunId).filter((x): x is string => !!x)])]);

  let generated: Generated;
  try {
    generated = await structured("courses.blueprint", {
      system: BLUEPRINT_SYSTEM,
      user: [
        `Course title: ${title}`, `Topic: ${topic}`, `Audience level: ${body.audience}`,
        notes.length ? `Outdated, according to the research:\n${notes.map((n) => `- ${n.item}${n.replacedBy ? ` -> ${n.replacedBy}` : ""}`).join("\n")}` : "",
        "", renderContext(sources, passages),
      ].join("\n"),
      schema: BlueprintSchema, maxTokens: 16_000, timeoutMs: 240_000, estimateUsd: estimateUsd("blueprint"),
      accountId: actor.id, requestId,
    });
  } catch (err) {
    if (!(err instanceof AiUnavailable)) throw err;
    return refused(err.code === "ai_off" ? 503 : err.code === "cap_reached" ? 429 : 502, err.message, A, { type: "course", id: slug, label: title });
  }
  const plan = toPlan(generated, passages);
  if (!plan.modules.length) return refused(502, "The model didn't propose a usable outline. Nothing was saved.", A);

  const db = getDb();
  let academy = (await db.from("academies").select("id, name").eq("slug", slug).maybeSingle()).data as { id: string; name: string } | null;
  if (!academy) {
    const ins = await db.from("academies").insert({ slug, name: title, outcome: plan.outcome || null }).select("id, name").single();
    if (ins.error) throw new Error(`academy insert failed: ${ins.error.message}`);
    academy = ins.data as { id: string; name: string };
  }
  const { data, error } = await db.from("academy_blueprints").insert({
    account_id: actor.id, academy_id: academy.id, kind: "course", status: "draft", topic, audience_level: body.audience,
    plan, outdated_notes: notes, source_ids: sources.map((s) => s.id), research_run_ids: runIds, generated_by: "ai",
    model: AI_MODELS["courses.blueprint"], outcome: plan.outcome || null, retention_class: "content",
    sources_summary: sources.map((s) => `${s.title} (checked ${s.lastChecked ?? "unknown"})`).join("; ").slice(0, 2000),
  }).select("id").single();
  if (error) throw new Error(`blueprint insert failed: ${error.message}`);
  const id = (data as { id: string }).id;
  const lessons = lessonCount(plan);
  const uncited = uncitedCount(plan);
  return {
    ok: true, status: 201, body: { id, modules: plan.modules.length, lessons, uncitedClaims: uncited, outdated: notes.length },
    event: {
      action: A, result: "Completed", target: { type: "blueprint", id, label: `${slug}: ${title}` }, previous: "none", next: "draft",
      context: `AI proposed a Blueprint for "${title}" from ${sources.length} approved source(s): ${plan.modules.length} module(s), ${lessons} lesson(s)${uncited ? `, ${uncited} key claim(s) with no source (marked)` : ""}, ${notes.length} outdated note(s). A person approves or edits it before any lesson is written.`,
    },
  };
}

const KeyClaimIn = z.object({ claim: z.string().min(3).max(400), sourceId: z.string().uuid().nullable().optional(), claimId: z.string().uuid().nullable().optional(), quote: z.string().max(300).nullable().optional() });
const PlanIn = z.object({
  title: z.string().min(1).max(200), outcome: z.string().max(500),
  modules: z.array(z.object({
    title: z.string().min(1).max(200), stage: z.string().max(60).nullable().optional(),
    lessons: z.array(z.object({
      title: z.string().min(1).max(200), minutes: z.number().int().min(1).max(120).nullable().optional(),
      objectives: z.array(z.string().max(300)).max(8), keyClaims: z.array(KeyClaimIn).max(10),
    })).min(1).max(8),
    skills: z.array(z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/), name: z.string().min(1).max(120) })).max(8),
  })).min(1).max(8),
});

type BlueprintRow = { id: string; academy_id: string; kind: string; status: string; plan: Plan; source_ids: string[]; course_id: string | null };

async function blueprintFor(slug: string, id: string): Promise<BlueprintRow | null> {
  if (!isUuid(id)) return null;
  const db = getDb();
  const academy = (await db.from("academies").select("id").eq("slug", slug).maybeSingle()).data as { id: string } | null;
  if (!academy) return null;
  const bp = (await db.from("academy_blueprints").select("*").eq("id", id).maybeSingle()).data as BlueprintRow | null;
  return bp && bp.kind === "course" && bp.academy_id === academy.id ? bp : null;
}

/** A person edits a Draft Blueprint. Body: { plan }. Citations may only point at the Blueprint's approved sources. */
export async function editBlueprint(actor: Account, slug: string, id: string, body: Record<string, unknown>): Promise<Result> {
  const A = "courses.blueprint.edit";
  const scope = courseScope(actor, "courses.edit", slug);
  const bp = await blueprintFor(slug, id);
  if (!bp) return refused(404, "No such blueprint for this course.", A);
  if (scope) return refused(403, scope, A, { type: "blueprint", id });
  if (bp.status !== "draft") return refused(409, `This blueprint is ${bp.status}; generate a new one to change it.`, A, { type: "blueprint", id });
  const parsed = PlanIn.safeParse(body.plan);
  if (!parsed.success) return refused(400, "The outline isn't complete: every module needs a title and at least one lesson with a title.", A, { type: "blueprint", id });
  const plan = parsed.data as Plan;
  if (ATTORNEY.test(JSON.stringify(plan))) return refused(400, NO_ATTORNEY, A, { type: "blueprint", id });
  const allowed = new Set(bp.source_ids);
  const bad = plan.modules.flatMap((m) => m.lessons.flatMap((l) => l.keyClaims)).find((c) => c.sourceId && !allowed.has(c.sourceId));
  if (bad) return refused(400, "A key claim can only cite one of this blueprint's approved sources (or none: it is then marked).", A, { type: "blueprint", id });
  const { error } = await getDb().from("academy_blueprints").update({ plan, edited_by_account_id: actor.id, edited_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`blueprint edit failed: ${error.message}`);
  return {
    ok: true, body: { id, lessons: lessonCount(plan), uncitedClaims: uncitedCount(plan) },
    event: {
      action: A, result: "Completed", target: { type: "blueprint", id, label: plan.title }, previous: `${lessonCount(bp.plan)} lesson(s)`,
      next: `${lessonCount(plan)} lesson(s)`, context: `Edited the Blueprint "${plan.title}" by hand.`,
    },
  };
}

/** Approving creates the next Draft course version with its modules, lessons and skills (approve_course_blueprint). */
export async function approveBlueprint(actor: Account, slug: string, id: string): Promise<Result> {
  const A = "courses.blueprint.approve";
  const scope = courseScope(actor, "courses.edit", slug);
  const bp = await blueprintFor(slug, id);
  if (!bp) return refused(404, "No such blueprint for this course.", A);
  if (scope) return refused(403, scope, A, { type: "blueprint", id });
  if (bp.status !== "draft") return refused(409, `This blueprint is already ${bp.status}.`, A, { type: "blueprint", id });
  const { data, error } = await getDb().rpc("approve_course_blueprint", { p_blueprint: id, p_actor: actor.id });
  if (error) {
    if (/no longer approved/.test(error.message)) return refused(409, "A source this blueprint cites is no longer approved. Re-approve it, or edit the blueprint.", A, { type: "blueprint", id });
    if (/already/.test(error.message)) return refused(409, "This blueprint is already approved.", A, { type: "blueprint", id });
    throw new Error(`blueprint approval failed: ${error.message}`);
  }
  const courseId = String(data);
  return {
    ok: true, body: { id, courseId, lessons: lessonCount(bp.plan) },
    event: {
      action: A, result: "Completed", target: { type: "blueprint", id, label: bp.plan.title }, previous: "draft", next: "approved",
      context: `Approved the Blueprint "${bp.plan.title}": a Draft course version with ${lessonCount(bp.plan)} lesson(s) was created. No lesson is written yet.`,
    },
  };
}
