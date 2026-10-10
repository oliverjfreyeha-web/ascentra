/**
 * I1: the course import file, format version 1, defined once here. Pure: no database, no network. The Owner writes a
 * finished course in chat and pastes or uploads it as one JSON file; this checks it and turns it into exactly what the
 * existing tables hold (a Draft course version, its modules, lessons and Draft lesson versions, Draft practice items,
 * video slots waiting for video, the capstone, the notices, sources in the library as "proposed"). The file is
 * untrusted data, never instructions: every string has HTML and scripts stripped, links must be https, nothing in it is
 * fetched or run, and the income-claims and attorney checks run on every text field. Described for people in
 * docs/COURSE-IMPORT.md. Tested in tests/unit/course-import.test.ts.
 */
import { z } from "zod";
import { MIN_MODULE_TYPES, TYPE_LABEL, checkItem, gradingOf, isItemType, ITEM_TYPES, type ItemType } from "@/lib/activities/types";
import { ATTORNEY, NO_ATTORNEY } from "@/lib/courses/wording";
import { findIncomeClaims } from "@/lib/courses/income";
import { CORE_PARTS, RECIPE_CAPS, SANDBOX_LABEL, SIZE_TIERS, checkModuleCount, checkRecipe, typeFits, type ItemPart, type SizeTier } from "@/lib/courses/structure";

export const IMPORT_FORMAT_VERSION = 1;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

// ============ Untrusted text: strip HTML and scripts from every string ============

/** Removes script and style blocks (with their contents), every other tag, and control characters. */
export function stripHtml(s: string): string {
  return s
    .replace(/<\s*(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    // Control characters (keeps newline and tab).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export type Problem = { path: string; message: string; group: ProblemGroup };
export type ProblemGroup = "format" | "course" | "sources" | "modules" | "items" | "capstone" | "income" | "links";
const pathOf = (p: readonly PropertyKey[]) => p.map((k, i) => (typeof k === "number" ? `[${k}]` : `${i ? "." : ""}${String(k)}`)).join("") || "(file)";

/** Every string in the value, with HTML stripped; returns the cleaned value and the paths that changed. */
export function sanitize(value: unknown, path: (string | number)[] = [], changed: string[] = []): unknown {
  if (typeof value === "string") {
    const out = stripHtml(value);
    if (out !== value) changed.push(pathOf(path));
    return out;
  }
  if (Array.isArray(value)) return value.map((v, i) => sanitize(v, [...path, i], changed));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = sanitize(v, [...path, k], changed);
    }
    return out;
  }
  return value;
}

// ============ The schema ============

const isHttps = (v: string) => {
  if (!/^https:\/\/[^\s<>"'`]+$/.test(v)) return false;
  try { return new URL(v).protocol === "https:"; } catch { return false; }
};
const text = (max: number, min = 1) => z.string().trim().min(min, min > 1 ? `needs at least ${min} characters` : "can't be empty").max(max, `${max} characters at most`);
const optText = (max: number) => z.string().trim().max(max, `${max} characters at most`).optional();
const link = z.string().trim().max(500, "500 characters at most").refine(isHttps, "must be an https:// link");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date like 2026-10-01").refine((d) => !Number.isNaN(Date.parse(d)), "isn't a real date");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "1 to 40 letters, numbers, - or _");
const slug = z.string().regex(/^[a-z0-9-]{2,60}$/, "a topic slug, like seo-services");
const list = <T extends z.ZodTypeAny>(t: T, max: number, min = 0) => z.array(t).min(min, `needs at least ${min}`).max(max, `${max} at most`);
const IMPORTANCE = z.enum(["should_know", "important", "very_important"]);

const Paragraph = z.strictObject({ text: text(3000), sourceIds: list(id, 8).default([]) });
const Lesson = z.strictObject({
  title: text(200, 3), minutes: z.number().int().min(3).max(60).optional(), objectives: list(text(300), 6).default([]),
  summary: text(1000), sections: list(z.strictObject({ heading: text(200), paragraphs: list(Paragraph, 20, 1) }), 12, 1),
  takeaways: list(z.strictObject({ text: text(400), sourceIds: list(id, 8).default([]) }), 8).default([]),
});
const VideoBrief = z.strictObject({
  mustCover: list(text(400), 12, 1), lengthMinutes: z.number().int().min(2).max(15), tone: optText(200),
  onScreenExamples: list(text(300), 10).default([]), sourceIds: list(id, 8).default([]), avoid: list(text(300), 10).default([]),
});
const Item = z.strictObject({
  kind: z.enum(["video", "quiz", "assignment", "sandbox", "sequence", "booster"]),
  title: text(200, 3), lesson: z.number().int().min(1).max(6).default(1),
  taskType: z.string().optional(), booster: z.string().optional(),
  importance: IMPORTANCE, sourceIds: list(id, 8, 1),
  notebookNote: optText(800), level: z.enum(["beginner", "intermediate"]).optional(),
  prompt: optText(2000), explanation: optText(2000),
  content: z.record(z.string(), z.unknown()).optional(), answerKey: z.record(z.string(), z.unknown()).nullable().optional(),
  videoBrief: VideoBrief.optional(),
});
const Recipe = z.strictObject({
  videos: z.number().int(), quizzes: z.number().int(), assignments: z.number().int(), sandboxes: z.number().int(), sequences: z.number().int(),
  boosters: list(z.string(), 10).default([]),
});
const Module = z.strictObject({
  number: z.number().int().min(1), title: text(200, 3), difficulty: z.number().int().min(1).max(5), bigQuestion: text(400),
  canDo: list(text(300), 8, 1), hours: z.number().min(0.5).max(40), keyTerms: list(text(100), 30).default([]),
  examples: list(text(600), 20).default([]), mistakes: list(text(400), 20).default([]), sourceIds: list(id, 30, 1),
  recipe: Recipe, lessons: list(Lesson, 6, 1), items: list(Item, 40, 1),
});
export const ImportFile = z.strictObject({
  formatVersion: z.literal(IMPORT_FORMAT_VERSION, { error: `must be ${IMPORT_FORMAT_VERSION}` }),
  topicSlug: slug,
  course: z.strictObject({
    title: text(200, 3), sizeTier: z.enum(["compact", "standard", "large"]),
    hoursPerWeek: z.strictObject({ min: z.number().int().min(1).max(40), max: z.number().int().min(1).max(40) }),
    roadmap: text(4000), audience: text(2000),
    teenStatus: z.strictObject({ status: z.enum(["open", "hidden"]), reason: text(600) }),
    outcomes: list(text(300), 12, 1),
    requirements: z.strictObject({ ageLimits: optText(1000), licenses: optText(1000), taxes: optText(1000), platformAccounts: optText(1000) }),
    legalChecklist: list(text(300), 30).default([]),
    notices: z.strictObject({ license: optText(600), software: optText(600) }).default({}),
    marketing: optText(4000), growth: list(text(400), 20).default([]),
    glossary: list(z.strictObject({ term: text(100), meaning: text(600) }), 100).default([]),
    toolsAndCosts: list(z.strictObject({ tool: text(100), what: text(400), cost: z.enum(["free", "paid"]), priceRange: optText(100), link, checkedOn: day }), 40).default([]),
    commonMistakes: list(text(400), 30).default([]), skillsTaught: list(slug, 20).default([]), coverageChecklist: list(text(300), 40).default([]),
  }),
  sources: list(z.strictObject({
    id, kind: z.enum(["youtube", "official", "article", "owner_tip"]), title: text(300), link, creditLine: text(300),
    licenseClass: z.enum(["open", "owner_supplied", "web_summarize_only"]),
  }), 200, 1),
  resources: list(z.strictObject({ name: text(200), link, license: text(100), termsChecked: z.boolean(), okToUseText: z.boolean(), checkedOn: day }), 100).default([]),
  freshnessWatch: list(z.strictObject({ what: text(300), link, howOften: text(60) }), 50).default([]),
  capstone: z.strictObject({
    title: text(200, 3), brief: optText(2000), deliverables: list(text(300), 12, 1), selfCheck: list(text(300), 20, 1),
    automation: z.strictObject({
      whatAutomated: text(1000, 10), masterPrompts: list(z.strictObject({ title: text(120), purpose: text(600) }), 12).default([]),
      aiPlans: list(z.strictObject({ name: text(80), price: text(60), link, checkedOn: day }), 3).default([]),
    }).optional(),
  }),
  modules: list(Module, 9, 1),
});
export type ImportDoc = z.infer<typeof ImportFile>;

// ============ What the check needs from the database (read only) ============

export type ImportContext = {
  topic: { slug: string; name: string; kind: "business" | "side_hustle" | "skill"; teenHidden: boolean; published: boolean; draftVersions: number } | null;
  skillSlugs: ReadonlySet<string>;
  boosters: readonly { key: string; itemTypes: readonly string[] }[];
  today?: string;
};

export type ImportSummary = {
  topic: string | null; title: string | null; sizeTier: SizeTier | null; modules: number; lessons: number;
  items: Record<string, number>; videoSlots: number; sources: number; resources: number; resourcesHidden: number;
  capstone: boolean; notices: number; newDraftVersion: boolean;
};
export type ImportCheck = {
  ok: boolean; problems: Problem[]; warnings: { path: string; message: string }[]; summary: ImportSummary; plan: ImportPlan | null;
  bytes: number;
};

// ============ The check ============

const ITEM_PART: Record<string, ItemPart> = { quiz: "quiz", assignment: "assignment", sandbox: "sandbox", sequence: "sequence", booster: "booster" };
const SOURCE_TYPE = { youtube: "YouTube video", official: "Official source", article: "Article", owner_tip: "Owner tip" } as const;
const SPONSORED = /\b(sponsor|affiliate link|promo code|use code)\b/i;
// Fields that are links or ids: not prose, so not run through the income check (links are checked as links).
const NOT_PROSE = /^(link|id|sourceIds|topicSlug|skillsTaught|kind|taskType|booster|importance|level|licenseClass|sizeTier|status|cost|checkedOn)$/;

/** Every prose string in the document with its path, for the income-claims and attorney checks. */
function proseOf(value: unknown, path: (string | number)[] = []): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path: pathOf(path), text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => proseOf(v, [...path, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (NOT_PROSE.test(k) && path.length ? [] : proseOf(v, [...path, k])));
  }
  return [];
}

const ideaKey = (s: string, i: number) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "item"}-${i + 1}`.slice(0, 60);
const srcRef = (key: string) => `@@src:${key}@@`;

/** Parses and checks a file's text. Writes nothing. */
export function checkImport(raw: string, ctx: ImportContext): ImportCheck {
  const bytes = new TextEncoder().encode(raw).length;
  const problems: Problem[] = [];
  const warnings: { path: string; message: string }[] = [];
  const summary: ImportSummary = {
    topic: null, title: null, sizeTier: null, modules: 0, lessons: 0, items: {}, videoSlots: 0, sources: 0, resources: 0, resourcesHidden: 0,
    capstone: false, notices: 0, newDraftVersion: false,
  };
  const done = (plan: ImportPlan | null = null): ImportCheck => ({ ok: !problems.length && !!plan, problems, warnings, summary, plan: problems.length ? null : plan, bytes });
  if (bytes > IMPORT_MAX_BYTES) { problems.push({ path: "(file)", message: `The file is ${(bytes / 1024 / 1024).toFixed(1)} MB; 2 MB at most.`, group: "format" }); return done(); }
  let json: unknown;
  try { json = JSON.parse(raw); } catch (e) {
    problems.push({ path: "(file)", message: `This isn't valid JSON (${e instanceof Error ? e.message.slice(0, 120) : "parse error"}).`, group: "format" });
    return done();
  }
  const stripped: string[] = [];
  const clean = sanitize(json, [], stripped);
  if (stripped.length) warnings.push({ path: stripped.slice(0, 5).join(", ") + (stripped.length > 5 ? ` and ${stripped.length - 5} more` : ""), message: `HTML or script was removed from ${stripped.length} field(s). Only plain text is kept.` });
  const parsed = ImportFile.safeParse(clean);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 200)) {
      const p = pathOf(i.path);
      const message = i.code === "unrecognized_keys" ? `unknown field(s): ${(i as { keys: string[] }).keys.join(", ")}` : i.message;
      problems.push({ path: p, message, group: /link/.test(p) ? "links" : /^modules/.test(p) ? (/items/.test(p) ? "items" : "modules") : /^sources/.test(p) ? "sources" : /^capstone/.test(p) ? "capstone" : /^course/.test(p) ? "course" : "format" });
    }
    return done();
  }
  const d = parsed.data;
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const add = (group: ProblemGroup, path: string, message: string) => problems.push({ path, message, group });
  summary.title = d.course.title;
  summary.sizeTier = d.course.sizeTier;

  // The topic.
  if (!ctx.topic) add("course", "topicSlug", `unknown topic "${d.topicSlug}". Use the slug of an existing business, side hustle or skill from /admin/topics.`);
  else {
    summary.topic = ctx.topic.name;
    summary.newDraftVersion = ctx.topic.draftVersions > 0;
    if (ctx.topic.published) add("course", "topicSlug", `"${ctx.topic.name}" already has a published course. An import never changes a published course; start a new version from the course editor instead.`);
    if ((d.course.teenStatus.status === "hidden") !== ctx.topic.teenHidden) {
      warnings.push({ path: "course.teenStatus", message: `The file says ${d.course.teenStatus.status} for teens, but the topic is ${ctx.topic.teenHidden ? "hidden from" : "shown to"} teens. The import doesn't change the topic: set it in /admin/topics.` });
    }
  }

  // The course.
  const count = checkModuleCount(d.modules.length, d.course.sizeTier);
  if (count) add("course", "modules", count);
  if (d.course.hoursPerWeek.min > d.course.hoursPerWeek.max) add("course", "course.hoursPerWeek", "min can't be more than max");
  const t = SIZE_TIERS[d.course.sizeTier].hoursPerWeek;
  if (d.course.hoursPerWeek.min < t.min || d.course.hoursPerWeek.max > t.max) warnings.push({ path: "course.hoursPerWeek", message: `A ${SIZE_TIERS[d.course.sizeTier].label} course is ${t.min} to ${t.max} hours a week; the file says ${d.course.hoursPerWeek.min} to ${d.course.hoursPerWeek.max}.` });
  d.course.skillsTaught.forEach((s, i) => { if (!ctx.skillSlugs.has(s)) add("course", `course.skillsTaught[${i}]`, `unknown skill "${s}"`); });
  for (const [k, v] of Object.entries(d.course.notices)) {
    if (!v) continue;
    if (v.length < 10) add("course", `course.notices.${k}`, "a notice needs at least a sentence (10 characters)");
    if (SPONSORED.test(v)) add("course", `course.notices.${k}`, "notices are general information, never sponsored");
  }
  summary.notices = Object.values(d.course.notices).filter(Boolean).length;
  const future = (path: string, v: string) => { if (v > today) add("course", path, "a checked-on date can't be in the future"); };
  d.course.toolsAndCosts.forEach((x, i) => future(`course.toolsAndCosts[${i}].checkedOn`, x.checkedOn));
  d.resources.forEach((x, i) => future(`resources[${i}].checkedOn`, x.checkedOn));
  d.capstone.automation?.aiPlans.forEach((x, i) => future(`capstone.automation.aiPlans[${i}].checkedOn`, x.checkedOn));

  // Sources and resources.
  const sourceIds = new Map<string, number>();
  d.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) add("sources", `sources[${i}].id`, `duplicate source id "${s.id}" (also sources[${sourceIds.get(s.id)}])`);
    else sourceIds.set(s.id, i);
    if (s.licenseClass === "web_summarize_only") warnings.push({ path: `sources[${i}]`, message: `"${s.title}" may only be summarized and credited, never copied.` });
  });
  const seenUrl = new Map<string, number>();
  d.sources.forEach((s, i) => {
    const u = s.link.toLowerCase();
    if (seenUrl.has(u)) add("sources", `sources[${i}].link`, `the same link as sources[${seenUrl.get(u)}]`);
    else seenUrl.set(u, i);
  });
  summary.sources = d.sources.length;
  summary.resources = d.resources.length;
  summary.resourcesHidden = d.resources.filter((r) => !r.termsChecked).length;
  d.resources.forEach((r, i) => {
    if (!r.termsChecked) warnings.push({ path: `resources[${i}]`, message: `"${r.name}": terms not checked, so it is stored but not shown to learners.` });
    else if (!r.okToUseText) warnings.push({ path: `resources[${i}]`, message: `"${r.name}": linked only; its text isn't used.` });
  });
  const refs = (path: string, ids: readonly string[]) => ids.forEach((x, i) => { if (!sourceIds.has(x)) add("sources", `${path}[${i}]`, `unknown source "${x}"`); });

  // Modules and items.
  const boosterTypes = (key: string) => ctx.boosters.find((b) => b.key === key)?.itemTypes ?? [];
  const activeBoosters = ctx.boosters.map((b) => b.key);
  const numbers = new Set<number>();
  d.modules.forEach((m, mi) => {
    const at = `modules[${mi}]`;
    if (m.number !== mi + 1) add("modules", `${at}.number`, `modules are numbered 1, 2, 3… in order (expected ${mi + 1})`);
    if (numbers.has(m.number)) add("modules", `${at}.number`, `duplicate module number ${m.number}`);
    numbers.add(m.number);
    if (mi > 0 && m.difficulty < d.modules[mi - 1].difficulty) add("modules", `${at}.difficulty`, `difficulty can't go down (module ${mi} is ${d.modules[mi - 1].difficulty}, this is ${m.difficulty})`);
    const r = checkRecipe(m.recipe, activeBoosters);
    if ("problem" in r) add("modules", `${at}.recipe`, r.problem);
    refs(`${at}.sourceIds`, m.sourceIds);
    m.lessons.forEach((l, li) => {
      l.sections.forEach((s, si) => s.paragraphs.forEach((p, pi) => refs(`${at}.lessons[${li}].sections[${si}].paragraphs[${pi}].sourceIds`, p.sourceIds)));
      l.takeaways.forEach((tk, ti) => refs(`${at}.lessons[${li}].takeaways[${ti}].sourceIds`, tk.sourceIds));
    });
    const types = new Set<string>();
    const counts: Record<string, number> = {};
    m.items.forEach((it, ii) => {
      const ip = `${at}.items[${ii}]`;
      counts[it.kind] = (counts[it.kind] ?? 0) + 1;
      summary.items[it.kind] = (summary.items[it.kind] ?? 0) + 1;
      refs(`${ip}.sourceIds`, it.sourceIds);
      if (it.lesson > m.lessons.length) add("items", `${ip}.lesson`, `this module has ${m.lessons.length} lesson(s)`);
      if (it.importance === "very_important" && (!it.notebookNote || it.notebookNote.length < 20)) add("items", `${ip}.notebookNote`, "a Very important item needs its Notebook note (20 to 800 characters)");
      if (it.kind === "video") {
        if (!it.videoBrief) add("items", `${ip}.videoBrief`, "a video item needs its brief (mustCover, lengthMinutes, tone, onScreenExamples, sourceIds, avoid)");
        else refs(`${ip}.videoBrief.sourceIds`, it.videoBrief.sourceIds);
        for (const k of ["taskType", "prompt", "explanation", "content", "answerKey"] as const) if (it[k] !== undefined) add("items", `${ip}.${k}`, "a video item has a videoBrief, not this field");
        summary.videoSlots++;
        return;
      }
      if (it.videoBrief) add("items", `${ip}.videoBrief`, "only a video item has a brief");
      if (!it.taskType || !isItemType(it.taskType)) {
        add("items", `${ip}.taskType`, `${it.taskType ? `"${it.taskType}" isn't a task type the app supports` : "needs a task type"}. Use one of: ${ITEM_TYPES.join(", ")}`);
        return;
      }
      const type: ItemType = it.taskType;
      types.add(type);
      const part = ITEM_PART[it.kind];
      if (it.kind === "booster") {
        if (!it.booster || !activeBoosters.includes(it.booster)) add("items", `${ip}.booster`, `a booster item names an active learning booster: ${activeBoosters.join(", ")}`);
        else if (!typeFits(type, "booster", boosterTypes(it.booster))) add("items", `${ip}.taskType`, `"${it.booster}" uses ${boosterTypes(it.booster).join(" or ")}`);
      } else {
        if (it.booster !== undefined) add("items", `${ip}.booster`, "only a booster item names a booster");
        if (!typeFits(type, part)) add("items", `${ip}.taskType`, `a ${it.kind} can't be a ${TYPE_LABEL[type]}`);
      }
      if (!it.prompt || it.prompt.length < 3) add("items", `${ip}.prompt`, "needs the question or task (3 to 2000 characters)");
      if (!it.explanation || it.explanation.length < 3) add("items", `${ip}.explanation`, "needs the explanation shown after trying (3 to 2000 characters)");
      const content = it.content ?? {};
      const key = it.answerKey === undefined ? null : it.answerKey;
      const bad = checkItem(type, content, key);
      if (bad) add("items", gradingOf(type) === "code" && /answer key/.test(bad) ? `${ip}.answerKey` : `${ip}.content`, bad);
      if (it.kind === "sandbox") warnings.push({ path: ip, message: `Shown to learners as "${SANDBOX_LABEL}".` });
    });
    if (types.size < MIN_MODULE_TYPES) add("items", `${at}.items`, `needs at least ${MIN_MODULE_TYPES} different task types (has ${types.size})`);
    if ("recipe" in r) {
      const want = { video: r.recipe.videos, quiz: r.recipe.quizzes, assignment: r.recipe.assignments, sandbox: r.recipe.sandboxes, sequence: r.recipe.sequences } as const;
      for (const [k, n] of Object.entries(want)) if ((counts[k] ?? 0) < n) warnings.push({ path: `${at}.items`, message: `the recipe asks for ${n} ${k} item(s); the file has ${counts[k] ?? 0}. The Owner's review shows what's short.` });
    }
  });
  summary.modules = d.modules.length;
  summary.lessons = d.modules.reduce((n, m) => n + m.lessons.length, 0);

  // The capstone (a business course needs "Automation with AI").
  summary.capstone = true;
  if (ctx.topic?.kind === "business" && !d.capstone.automation) add("capstone", "capstone.automation", "a business course's capstone needs \"Automation with AI\" (whatAutomated, masterPrompts, aiPlans)");

  // Income claims and attorney approval, on every text field.
  for (const p of proseOf(d)) {
    if (ATTORNEY.test(p.text)) add("income", p.path, NO_ATTORNEY);
    for (const c of findIncomeClaims(p.text)) add("income", p.path, `reads as ${c.claim}: "${c.text}". Reword it.`);
  }
  // A link in a prose field must still be https (no javascript: or data: anywhere).
  for (const p of proseOf(clean)) if (/\b(javascript|data|vbscript):/i.test(p.text)) add("links", p.path, "contains a script or data link; only https links are allowed");

  return done(problems.length ? null : toPlan(d, ctx));
}

// ============ The plan the database function stores ============

export type ImportPlan = {
  topicSlug: string; title: string; summary: string; sizeTier: SizeTier; audienceLevel: "beginner" | "intermediate";
  notices: { license: string | null; software: string | null };
  sources: { key: string; title: string; url: string; sourceType: string; licenseClass: string; creditLine: string }[];
  modules: {
    position: number; title: string; recipe: Record<string, unknown>;
    lessons: { position: number; title: string; minutes: number | null; objectives: string[]; body: unknown; citations: unknown[]; uncited: number }[];
    videos: { position: number; lessonPosition: number; title: string; brief: unknown; importance: string; notebookNote: string | null }[];
    items: {
      lessonPosition: number; ideaKey: string; itemType: string; grading: string; level: string; goal: string; prompt: string; content: unknown; answerKey: unknown;
      explanation: string; citation: unknown; part: string; booster: string | null; importance: string; notebookNote: string | null;
    }[];
  }[];
  capstone: { title: string; brief: string; deliverables: string[]; checklist: string[]; automation: unknown; plansCheckedOn: string | null };
  blueprint: Record<string, unknown>;
};

function toPlan(d: ImportDoc, ctx: ImportContext): ImportPlan {
  const src = new Map(d.sources.map((s) => [s.id, s]));
  const cite = (key: string) => ({ sourceId: srcRef(key), title: src.get(key)!.title, url: src.get(key)!.link });
  const modules = d.modules.map((m) => {
    const level = m.difficulty <= 2 ? "beginner" : "intermediate";
    const lessons = m.lessons.map((l, li) => {
      // The lesson's citations: each source it cites once, numbered in order of first use.
      const order: string[] = [];
      const refOf = (ids: readonly string[]) => ids.map((x) => { if (!order.includes(x)) order.push(x); return order.indexOf(x) + 1; });
      let uncited = 0;
      const sections = l.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs.map((p) => { if (!p.sourceIds.length) uncited++; return { text: p.text, refs: refOf(p.sourceIds) }; }) }));
      const takeaways = l.takeaways.map((t) => ({ text: t.text, refs: refOf(t.sourceIds) }));
      const citations = order.map((k, i) => ({ ref: i + 1, sourceId: srcRef(k), title: src.get(k)!.title, url: src.get(k)!.link, license: src.get(k)!.licenseClass, lastChecked: null, credit: src.get(k)!.creditLine }));
      return { position: li + 1, title: l.title, minutes: l.minutes ?? null, objectives: l.objectives.length ? l.objectives : li === 0 ? m.canDo.slice(0, 6) : [], body: { summary: l.summary, sections, takeaways }, citations, uncited };
    });
    let vpos = 0;
    const videos = m.items.filter((it) => it.kind === "video").map((it) => ({
      position: ++vpos, lessonPosition: it.lesson, title: it.title, importance: it.importance, notebookNote: it.notebookNote ?? null,
      brief: {
        purpose: "", points: it.videoBrief!.mustCover.map((text) => ({ text, sources: [...new Set([...it.videoBrief!.sourceIds, ...it.sourceIds])].map((k) => ({ sourceId: srcRef(k), title: src.get(k)!.title })) })),
        targetMinutes: it.videoBrief!.lengthMinutes, tone: it.videoBrief!.tone ?? "", onScreen: it.videoBrief!.onScreenExamples, avoid: it.videoBrief!.avoid,
      },
    }));
    const items = m.items.map((it, ii) => ({ it, ii })).filter(({ it }) => it.kind !== "video").map(({ it, ii }) => {
      const type = it.taskType as ItemType;
      return {
        lessonPosition: it.lesson, ideaKey: ideaKey(it.title, ii), itemType: type, grading: gradingOf(type), level: it.level ?? level, goal: it.title, prompt: it.prompt!,
        content: it.content ?? {}, answerKey: gradingOf(type) === "code" ? it.answerKey ?? null : null, explanation: it.explanation!, citation: cite(it.sourceIds[0]),
        part: it.kind, booster: it.kind === "booster" ? it.booster! : null, importance: it.importance, notebookNote: it.notebookNote ?? null,
      };
    });
    const recipe = { ...Object.fromEntries(CORE_PARTS.map((p) => [p, m.recipe[p]])), boosters: [...new Set(m.recipe.boosters)].slice(0, RECIPE_CAPS.boosters.max) };
    return { position: m.number, title: m.title, recipe, lessons, videos, items };
  });
  const a = d.capstone.automation;
  const automation = a ? { what: a.whatAutomated, prompts: a.masterPrompts.map((p) => `${p.title}: ${p.purpose}`), plans: a.aiPlans.map((p) => ({ name: p.name, price: p.price, sourceUrl: p.link, checkedOn: p.checkedOn })) } : null;
  const outcome = d.course.outcomes.join(" ");
  const guide = Object.fromEntries(Object.entries(d.course).filter(([k]) => !(["title", "sizeTier", "notices"] as string[]).includes(k)));
  return {
    topicSlug: d.topicSlug, title: d.course.title, summary: outcome.slice(0, 2000), sizeTier: d.course.sizeTier,
    audienceLevel: d.modules[0].difficulty <= 2 ? "beginner" : "intermediate",
    notices: { license: d.course.notices.license ?? null, software: d.course.notices.software ?? null },
    sources: d.sources.map((s) => ({ key: s.id, title: s.title, url: s.link, sourceType: SOURCE_TYPE[s.kind], licenseClass: s.licenseClass, creditLine: s.creditLine })),
    modules,
    capstone: {
      title: d.capstone.title, brief: d.capstone.brief ?? "", deliverables: d.capstone.deliverables, checklist: d.capstone.selfCheck, automation,
      plansCheckedOn: a?.aiPlans.length ? a.aiPlans.map((p) => p.checkedOn).sort()[0] : null,
    },
    // The Blueprint record (the existing home for a course plan): the same v2 shape the editor reads, plus what the file
    // holds that has no other home (the course guide, resources, what to watch for freshness, the module details).
    blueprint: {
      structure: 2, sizeTier: d.course.sizeTier, title: d.course.title, outcome,
      modules: d.modules.map((m, mi) => ({
        title: m.title, stage: null, recipe: modules[mi].recipe, skills: [],
        lessons: m.lessons.map((l) => ({ title: l.title, minutes: l.minutes ?? null, objectives: l.objectives, keyClaims: [] })),
        videos: modules[mi].videos.map((v) => ({ title: v.title, brief: v.brief })),
      })),
      imported: {
        formatVersion: IMPORT_FORMAT_VERSION, topicKind: ctx.topic?.kind ?? null, guide, resources: d.resources, freshnessWatch: d.freshnessWatch,
        moduleDetails: d.modules.map((m) => ({ number: m.number, difficulty: m.difficulty, bigQuestion: m.bigQuestion, canDo: m.canDo, hours: m.hours, keyTerms: m.keyTerms, examples: m.examples, mistakes: m.mistakes, sourceIds: m.sourceIds.map(srcRef) })),
        capstoneMasterPrompts: a?.masterPrompts ?? [],
      },
    },
  };
}

/** The groups, in the order the page lists them. */
export const PROBLEM_GROUPS: Record<ProblemGroup, string> = {
  format: "File format", course: "Course", sources: "Sources", modules: "Modules", items: "Items", capstone: "Capstone", income: "Income claims and attorney wording", links: "Links",
};
