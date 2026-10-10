/**
 * C2: what a business or side-hustle card says about starting it: the cost to start and the market outlook, the
 * difficulty and the risks, and the skills its course already teaches. Every number and label is entered by the Owner,
 * with its sources and the date it was checked; an empty field shows "Estimate coming", never a made-up number. Skills
 * have none of these. The income-claims check applies to every text field. Pure: tested in tests/unit/picks-c2.test.ts.
 */
import { ATTORNEY, NO_ATTORNEY } from "@/lib/courses/common";
import { findIncomeClaims } from "@/lib/courses/income";

export const OUTLOOK = { growing: "Growing", steady: "Steady", shrinking: "Shrinking", unclear: "Unclear" } as const;
export type Outlook = keyof typeof OUTLOOK;
export const ESTIMATE_COMING = "Estimate coming";
export const ESTIMATE_NOTE = "Estimate, not a promise.";
export const OVERLAP_NOTE = "Your business course already teaches this. Picking it adds extra practice in other settings.";

export type Source = { title: string; url: string };
export type FactsRow = {
  cost_low: number | string | null; cost_high: number | string | null; cost_items: { label: string }[]; cost_sources: Source[]; cost_checked_on: string | null;
  outlook_label: Outlook | null; outlook_sources: Source[]; outlook_checked_on: string | null; difficulty: number | null; risk_notes: string | null;
  teaches_skill_ids: string[];
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** What a card shows. Nothing invented: no number without its sources and date. */
export function cardFacts(row: Partial<FactsRow>) {
  // Rows made before C2 (or by an older test fixture) have none of these columns.
  const t: FactsRow = {
    cost_low: row.cost_low ?? null, cost_high: row.cost_high ?? null, cost_items: row.cost_items ?? [], cost_sources: row.cost_sources ?? [],
    cost_checked_on: row.cost_checked_on ?? null, outlook_label: row.outlook_label ?? null, outlook_sources: row.outlook_sources ?? [],
    outlook_checked_on: row.outlook_checked_on ?? null, difficulty: row.difficulty ?? null, risk_notes: row.risk_notes ?? null, teaches_skill_ids: row.teaches_skill_ids ?? [],
  };
  const low = t.cost_low == null ? null : Number(t.cost_low);
  const high = t.cost_high == null ? null : Number(t.cost_high);
  const cost = low == null || !t.cost_checked_on || !t.cost_sources.length ? null : {
    range: high != null && high !== low ? `${usd(low)} to ${usd(high)}` : usd(low),
    items: t.cost_items.map((i) => i.label),
    checkedOn: t.cost_checked_on, sources: t.cost_sources,
  };
  const outlook = !t.outlook_label || !t.outlook_checked_on || !t.outlook_sources.length ? null
    : { label: OUTLOOK[t.outlook_label], checkedOn: t.outlook_checked_on, sources: t.outlook_sources };
  return { cost, outlook, difficulty: t.difficulty, riskNotes: t.risk_notes, empty: ESTIMATE_COMING, note: ESTIMATE_NOTE };
}

const today = () => new Date().toISOString().slice(0, 10);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v <= today();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function sources(v: unknown): Source[] | string {
  if (!Array.isArray(v)) return "Sources are a list of { title, url }.";
  const out: Source[] = [];
  for (const s of v.slice(0, 8)) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const title = text(o.title, 200);
    const url = text(o.url, 500);
    if (title.length < 3 || !/^https:\/\/[^\s]+$/.test(url)) return "Each source needs a title and an https link.";
    out.push({ title, url });
  }
  return out;
}

/**
 * Checks the Owner's edit of these fields (body keys: costLow, costHigh, costItems, costSources, costCheckedOn,
 * outlookLabel, outlookSources, outlookCheckedOn, difficulty, riskNotes). Returns the columns to write, or a problem.
 */
export function checkFacts(kind: string, body: Record<string, unknown>): { fields: Partial<FactsRow> } | { problem: string } {
  const keys = ["costLow", "costHigh", "costItems", "costSources", "costCheckedOn", "outlookLabel", "outlookSources", "outlookCheckedOn", "difficulty", "riskNotes"];
  if (!keys.some((k) => body[k] !== undefined)) return { fields: {} };
  if (kind === "skill") return { problem: "Skills don't have a cost to start or a market outlook." };
  const f: Partial<FactsRow> = {};
  const num = (v: unknown) => (v === null || v === "" ? null : Number(v));
  if (body.costLow !== undefined) { const n = num(body.costLow); if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) return { problem: "The lowest cost is a dollar amount, 0 or more." }; f.cost_low = n; }
  if (body.costHigh !== undefined) { const n = num(body.costHigh); if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) return { problem: "The highest cost is a dollar amount, 0 or more." }; f.cost_high = n; }
  if (f.cost_low != null && f.cost_high != null && Number(f.cost_low) > Number(f.cost_high)) return { problem: "The lowest cost can't be more than the highest." };
  if (body.costItems !== undefined) {
    if (!Array.isArray(body.costItems)) return { problem: "What the cost covers is a list." };
    f.cost_items = body.costItems.slice(0, 12).map((i) => ({ label: text(typeof i === "string" ? i : (i as { label?: unknown })?.label, 120) })).filter((i) => i.label);
  }
  if (body.costSources !== undefined) { const s = sources(body.costSources); if (typeof s === "string") return { problem: s }; f.cost_sources = s; }
  if (body.costCheckedOn !== undefined) { if (body.costCheckedOn !== null && !isDay(body.costCheckedOn)) return { problem: "The checked date is a past date, like 2026-10-01." }; f.cost_checked_on = (body.costCheckedOn as string | null) ?? null; }
  if (body.outlookLabel !== undefined) {
    if (body.outlookLabel !== null && !(typeof body.outlookLabel === "string" && body.outlookLabel in OUTLOOK)) return { problem: "The outlook is Growing, Steady, Shrinking or Unclear." };
    f.outlook_label = (body.outlookLabel as Outlook | null) ?? null;
  }
  if (body.outlookSources !== undefined) { const s = sources(body.outlookSources); if (typeof s === "string") return { problem: s }; f.outlook_sources = s; }
  if (body.outlookCheckedOn !== undefined) { if (body.outlookCheckedOn !== null && !isDay(body.outlookCheckedOn)) return { problem: "The checked date is a past date, like 2026-10-01." }; f.outlook_checked_on = (body.outlookCheckedOn as string | null) ?? null; }
  if (body.difficulty !== undefined) {
    const d = body.difficulty === null ? null : Number(body.difficulty);
    if (d !== null && !(Number.isInteger(d) && d >= 1 && d <= 5)) return { problem: "Difficulty is 1 (easiest) to 5." };
    f.difficulty = d;
  }
  if (body.riskNotes !== undefined) f.risk_notes = text(body.riskNotes, 600) || null;
  const words = [...(f.cost_items ?? []).map((i) => i.label), f.risk_notes ?? "", ...(f.cost_sources ?? []).map((s) => s.title), ...(f.outlook_sources ?? []).map((s) => s.title)].join(" \n ");
  if (ATTORNEY.test(words)) return { problem: NO_ATTORNEY };
  const claim = findIncomeClaims(words)[0];
  if (claim) return { problem: `This reads as ${claim.claim}: "${claim.text}". Cards never promise income or results. Reword it.` };
  return { fields: f };
}

/** The overlap note for a skill, when the learner's business or side-hustle course already teaches it. */
export const overlapNote = (skillId: string, taughtByMyCourses: Set<string>) => (taughtByMyCourses.has(skillId) ? OVERLAP_NOTE : null);
