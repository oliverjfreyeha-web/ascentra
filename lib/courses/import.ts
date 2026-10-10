import "server-only";
import { createHash } from "node:crypto";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { refused, type Result } from "@/lib/courses/common";
import { IMPORT_MAX_BYTES, checkImport, type ImportCheck, type ImportContext } from "./import-format";

/**
 * I1: the Owner's Import course tool. "Check file" parses and checks the file and says what would be created; nothing
 * is written. "Create Draft" runs the same check, then the database function public.import_course
 * (db/migrations/0022_course_import.sql) creates a new Draft version in one transaction: all or nothing. Nothing is
 * published or approved here; the course then follows the usual flow (review, Reviewer verification, the Owner's
 * approval of each module, publish). Every check and every import is audited with the file's name, size and hash,
 * the topic and the counts. The file's contents are never logged.
 */

const A_CHECK = "courses.import.check";
const A_CREATE = "courses.import";

async function contextFor(topicSlug: unknown): Promise<ImportContext> {
  const db = getDb();
  const skills = ((await db.from("topics").select("slug").eq("kind", "skill")).data ?? []) as { slug: string }[];
  const boosters = ((await db.from("booster_types").select("key, item_types, active").eq("active", true)).data ?? []) as { key: string; item_types: string[] }[];
  let topic: ImportContext["topic"] = null;
  if (typeof topicSlug === "string" && /^[a-z0-9-]{2,60}$/.test(topicSlug)) {
    const t = (await db.from("topics").select("slug, name, kind, teen_hidden, catalog_slug").eq("slug", topicSlug).maybeSingle()).data as
      { slug: string; name: string; kind: "business" | "side_hustle" | "skill"; teen_hidden: boolean; catalog_slug: string | null } | null;
    if (t) {
      const academy = t.catalog_slug ? ((await db.from("academies").select("id").eq("slug", t.catalog_slug).maybeSingle()).data as { id: string } | null) : null;
      const courses = academy ? (((await db.from("courses").select("status, published_at").eq("academy_id", academy.id)).data ?? []) as { status: string; published_at: string | null }[]) : [];
      topic = { slug: t.slug, name: t.name, kind: t.kind, teenHidden: t.teen_hidden, published: courses.some((c) => !!c.published_at), draftVersions: courses.filter((c) => c.status === "draft").length };
    }
  }
  return { topic, skillSlugs: new Set(skills.map((s) => s.slug)), boosters: boosters.map((b) => ({ key: b.key, itemTypes: b.item_types })) };
}

type Input = { fileName: string; content: string };
function input(body: Record<string, unknown>): Input | string {
  const fileName = typeof body.fileName === "string" ? body.fileName.replace(/[^\w .()-]/g, "_").trim().slice(0, 120) : "";
  if (typeof body.content !== "string" || !body.content.trim()) return "Paste the course file or choose one.";
  if (body.content.length > IMPORT_MAX_BYTES * 2) return "The file is larger than 2 MB.";
  return { fileName: fileName || "pasted.json", content: body.content };
}
const topicOf = (raw: string) => { try { const j = JSON.parse(raw) as { topicSlug?: unknown }; return j && typeof j === "object" ? j.topicSlug : null; } catch { return null; } };
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
const counted = (c: ImportCheck) => `${c.summary.modules} modules, ${c.summary.lessons} lessons, ${Object.values(c.summary.items).reduce((a, b) => a + b, 0)} items (${c.summary.videoSlots} video slots), ${c.summary.sources} sources, ${c.summary.resources} resources`;
const view = (c: ImportCheck) => ({ ok: c.ok, problems: c.problems, warnings: c.warnings, summary: c.summary, bytes: c.bytes });

/** "Check file": a dry run. Body: { fileName, content }. Audited (with problems counted), never the contents. */
export async function checkCourseFile(actor: Account, body: Record<string, unknown>): Promise<Result> {
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner imports a course.", A_CHECK);
  const i = input(body);
  if (typeof i === "string") return refused(400, i, A_CHECK);
  const sha = createHash("sha256").update(i.content, "utf8").digest("hex");
  const c = checkImport(i.content, await contextFor(topicOf(i.content)));
  return {
    ok: true, body: { ...view(c), sha256: sha },
    event: {
      action: A_CHECK, result: c.ok ? "Completed" : "Blocked", target: { type: "course_file", id: sha.slice(0, 16), label: i.fileName },
      previous: null, next: c.ok ? "clean" : `${c.problems.length} problem(s)`,
      context: `Checked "${i.fileName}" (${kb(c.bytes)}, sha256 ${sha.slice(0, 16)}…) for the topic "${c.summary.topic ?? "unknown"}": ${c.ok ? `clean; would create ${counted(c)}` : `${c.problems.length} problem(s), nothing created`}.`,
    },
  };
}

/** "Create Draft": the same check, then one transaction. Body: { fileName, content }. Audited. */
export async function createCourseFromFile(actor: Account, body: Record<string, unknown>): Promise<Result> {
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner imports a course.", A_CREATE);
  const i = input(body);
  if (typeof i === "string") return refused(400, i, A_CREATE);
  const sha = createHash("sha256").update(i.content, "utf8").digest("hex");
  const c = checkImport(i.content, await contextFor(topicOf(i.content)));
  const target = { type: "course_file", id: sha.slice(0, 16), label: i.fileName };
  const what = `"${i.fileName}" (${kb(c.bytes)}, sha256 ${sha.slice(0, 16)}…) for the topic "${c.summary.topic ?? "unknown"}"`;
  if (!c.ok || !c.plan) {
    return { ok: true, status: 422, body: { ...view(c), sha256: sha, created: null }, event: { action: A_CREATE, result: "Blocked", target, previous: null, next: null, context: `Refused ${what}: ${c.problems.length} problem(s). Nothing was created.` } };
  }
  const { data, error } = await getDb().rpc("import_course", { p_actor: actor.id, p_plan: c.plan });
  if (error) {
    // The transaction rolled back: nothing was created. The database's own message is plain (it starts "ASCENTRA:").
    const reason = /^ASCENTRA: /.test(error.message) ? error.message.replace(/^ASCENTRA: /, "") : "The import couldn't be saved. Nothing was created.";
    return { ok: false, status: /already has a published course|unknown topic|linked to another/.test(reason) ? 409 : 500, reason, event: { action: A_CREATE, result: "Blocked", target, context: `Import of ${what} failed and was rolled back: ${reason}` } };
  }
  const r = data as { courseId: string; academySlug: string; version: number; blueprintId: string; counts: Record<string, number> };
  return {
    ok: true, status: 201,
    body: {
      ...view(c), sha256: sha,
      created: { courseId: r.courseId, version: r.version, academySlug: r.academySlug, counts: r.counts, editor: `/admin/courses/${r.academySlug}`, checklist: "/admin/review" },
    },
    event: {
      action: A_CREATE, result: "Completed", target: { type: "course", id: r.academySlug, label: c.summary.title ?? r.academySlug },
      previous: null, next: `version ${r.version} (Draft)`,
      context: `Imported ${what} as a Draft, version ${r.version}: ${r.counts.modules} modules, ${r.counts.lessons} lessons, ${r.counts.items} practice items, ${r.counts.videoSlots} video slots, ${r.counts.sources} sources (${r.counts.newSources} new, proposed), ${c.summary.resources} resources. Nothing was published or approved.`,
    },
  };
}
