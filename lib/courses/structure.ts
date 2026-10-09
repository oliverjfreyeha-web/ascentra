/**
 * C1: course structure v2, in one config file. The module recipe's parts, defaults and caps, the module count, the
 * recommended pace, which existing activity types fill which part, and the video limits. Pure: tested on its own
 * (tests/unit/course-structure.test.ts). The database stores each module's recipe as given; this file is the only
 * place the caps live.
 */
import { MIN_MODULE_TYPES, type ItemType } from "@/lib/activities/types";

/** A course has 5 or 6 modules, each harder than the last. */
export const MODULE_COUNT = { min: 5, max: 6 } as const;
/** Each module is designed for about one week, in depth. A recommendation only: nothing is time-locked. */
export const RECOMMENDED_PACE = "About 1 week";

export const CORE_PARTS = ["videos", "quizzes", "assignments", "sandboxes", "sequences"] as const;
export type CorePart = (typeof CORE_PARTS)[number];
export type Recipe = Record<CorePart, number> & { boosters: string[] };

/** At least one of each core part in every module, up to these caps; 0 to 5 boosters. */
export const RECIPE_CAPS: Record<CorePart, { min: number; max: number }> & { boosters: { min: number; max: number } } = {
  videos: { min: 1, max: 4 },
  quizzes: { min: 1, max: 4 },
  assignments: { min: 1, max: 3 },
  sandboxes: { min: 1, max: 3 },
  sequences: { min: 1, max: 3 },
  boosters: { min: 0, max: 5 },
};
export const DEFAULT_RECIPE: Recipe = { videos: 1, quizzes: 2, assignments: 1, sandboxes: 1, sequences: 1, boosters: ["common-mistakes-hunt", "teach-it-back"] };

export const PART_LABEL: Record<CorePart, string> = {
  videos: "Explainer videos", quizzes: "Quizzes", assignments: "Assignments", sandboxes: "Sandboxes", sequences: "Interactive sequences",
};

/** The part an activity item fills (stored on activity_items.recipe_part), and the existing types that can fill it. */
export type ItemPart = "quiz" | "assignment" | "sandbox" | "sequence" | "booster";
export const ITEM_PART_OF: Record<Exclude<ItemPart, "booster">, CorePart> = { quiz: "quizzes", assignment: "assignments", sandbox: "sandboxes", sequence: "sequences" };
export const PART_TYPES: Record<Exclude<ItemPart, "booster">, readonly ItemType[]> = {
  // Code-graded questions.
  quiz: ["multiple_choice", "true_false", "matching", "ordering", "flashcard"],
  // A written or applied task, with feedback.
  assignment: ["mini_project", "case_teardown", "short_answer"],
  // A safe practice space with made-up data and no live services: "Practice (simulated)".
  sandbox: ["build_it", "branching_scenario", "spot_the_mistake"],
  // A step-by-step walk-through.
  sequence: ["ordering", "branching_scenario", "build_it"],
};
export const SANDBOX_LABEL = "Practice (simulated)";

/** The part a drafted item fills when nobody chose one: by its type (ordering walks through steps; a build-it is a sandbox). */
export function defaultPartOf(type: ItemType): Exclude<ItemPart, "booster"> {
  if (type === "ordering") return "sequence";
  if (type === "branching_scenario") return "sequence";
  if (type === "build_it" || type === "spot_the_mistake") return "sandbox";
  if (type === "teach_back") return "assignment";
  return (PART_TYPES.quiz as readonly string[]).includes(type) ? "quiz" : "assignment";
}
/** Whether a type may fill a part (a booster's types come from the booster list). */
export function typeFits(type: ItemType, part: ItemPart, boosterTypes: readonly string[] = []): boolean {
  return part === "booster" ? boosterTypes.includes(type) : (PART_TYPES[part] as readonly string[]).includes(type);
}

const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/**
 * Checks a recipe against the caps and the active boosters. Returns the recipe (boosters de-duplicated) or the problem,
 * in plain words.
 */
export function checkRecipe(input: unknown, activeBoosters: readonly string[]): { recipe: Recipe } | { problem: string } {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const part of CORE_PARTS) {
    const { min, max } = RECIPE_CAPS[part];
    if (!intIn(r[part], min, max)) return { problem: `${PART_LABEL[part]}: choose ${min} to ${max}.` };
  }
  const boosters = Array.isArray(r.boosters) ? [...new Set(r.boosters.filter((b): b is string => typeof b === "string"))] : [];
  if (boosters.length > RECIPE_CAPS.boosters.max) return { problem: `Learning boosters: choose up to ${RECIPE_CAPS.boosters.max}.` };
  const unknown = boosters.find((b) => !activeBoosters.includes(b));
  if (unknown) return { problem: `"${unknown}" isn't on the list of learning boosters.` };
  return { recipe: { videos: r.videos as number, quizzes: r.quizzes as number, assignments: r.assignments as number, sandboxes: r.sandboxes as number, sequences: r.sequences as number, boosters } };
}

/** A recipe the model proposed, brought within the caps (never refused: a person reviews it in the Blueprint). */
export function clampRecipe(input: unknown, activeBoosters: readonly string[]): Recipe {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_RECIPE, boosters: [] as string[] };
  for (const part of CORE_PARTS) {
    const n = Number(r[part]);
    out[part] = Number.isFinite(n) ? Math.min(RECIPE_CAPS[part].max, Math.max(RECIPE_CAPS[part].min, Math.round(n))) : DEFAULT_RECIPE[part];
  }
  const boosters = Array.isArray(r.boosters) ? r.boosters.filter((b): b is string => typeof b === "string" && activeBoosters.includes(b)) : [];
  out.boosters = [...new Set(boosters)].slice(0, RECIPE_CAPS.boosters.max);
  return out;
}

export function checkModuleCount(n: number): string | null {
  return n >= MODULE_COUNT.min && n <= MODULE_COUNT.max ? null : `A course has ${MODULE_COUNT.min} or ${MODULE_COUNT.max} modules (this one has ${n}).`;
}

export type Coverage = {
  counts: Record<CorePart, number> & { boosters: number };
  missing: CorePart[]; // a core part with none at all
  short: { part: CorePart; have: number; want: number }[]; // fewer than the recipe asks for
  boostersMissing: string[]; // boosters in the recipe with no item yet
  types: number; varietyOk: boolean; // the L6 rule: at least 3 different activity types
};

/** What a module has against its recipe: video slots, and its reviewed (or published) items by part and type. */
export function coverage(recipe: Partial<Recipe> | null | undefined, slots: number, items: { item_type: string; recipe_part: string | null; booster_key: string | null }[]): Coverage {
  const want = { ...DEFAULT_RECIPE, ...(recipe ?? {}) } as Recipe;
  const counts = { videos: slots, quizzes: 0, assignments: 0, sandboxes: 0, sequences: 0, boosters: 0 };
  for (const i of items) {
    const part = (i.recipe_part ?? defaultPartOf(i.item_type as ItemType)) as ItemPart;
    if (part === "booster") counts.boosters++;
    else counts[ITEM_PART_OF[part]]++;
  }
  const types = new Set(items.map((i) => i.item_type)).size;
  return {
    counts,
    missing: CORE_PARTS.filter((p) => counts[p] === 0),
    short: CORE_PARTS.filter((p) => counts[p] > 0 && counts[p] < want[p]).map((p) => ({ part: p, have: counts[p], want: want[p] })),
    boostersMissing: (want.boosters ?? []).filter((b) => !items.some((i) => i.booster_key === b)),
    types, varietyOk: types >= MIN_MODULE_TYPES,
  };
}

// ============ Videos ============

/** The largest file accepted: 50 MB, the Supabase Free plan's upload limit (the "course-videos" bucket matches it). */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm" } as const;
export type VideoMime = keyof typeof VIDEO_TYPES;
/** How long a learner's link to a video works. */
export const VIDEO_LINK_SECONDS = 10 * 60;
export const MIN_TRANSCRIPT_CHARS = 20;

export const tooLarge = (bytes: number) =>
  `That file is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is ${VIDEO_MAX_BYTES / 1024 / 1024} MB per video: export a shorter or smaller file (for example 1080p at a lower bitrate), or split it into two videos.`;

/**
 * What a file really is, from its first bytes (never from its name): an MP4 has "ftyp" at byte 4; a WebM starts with the
 * EBML header 1A 45 DF A3 and declares the "webm" doc type.
 */
export function sniffVideo(head: Uint8Array): VideoMime | null {
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "video/mp4";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const text = String.fromCharCode(...head.slice(0, Math.min(head.length, 64)));
    return text.includes("webm") ? "video/webm" : null;
  }
  return null;
}

/** A video slot's brief, as the Owner pastes it into their video tool. */
export type VideoBrief = {
  purpose?: string; points?: { text: string; sources?: { sourceId?: string; title?: string }[] }[]; targetMinutes?: number | null;
  tone?: string; onScreen?: string[]; avoid?: string[];
};
export function briefText(title: string, b: VideoBrief): string {
  const lines = [`Video: ${title}`];
  if (b.purpose) lines.push("", `What it's for: ${b.purpose}`);
  if (b.points?.length) lines.push("", "Cover these points, in this order:", ...b.points.map((p, i) => `${i + 1}. ${p.text}${p.sources?.length ? ` (source: ${p.sources.map((s) => s.title ?? "a source").join("; ")})` : " (no source: check it before saying it)"}`));
  if (b.targetMinutes) lines.push("", `Target length: about ${b.targetMinutes} minutes.`);
  if (b.tone) lines.push(`Tone: ${b.tone}`);
  if (b.onScreen?.length) lines.push("", "Show on screen:", ...b.onScreen.map((s) => `- ${s}`));
  if (b.avoid?.length) lines.push("", "Avoid:", ...b.avoid.map((s) => `- ${s}`));
  lines.push("", "Never promise income, earnings or results. Use made-up examples, never real people's data.");
  return lines.join("\n");
}
