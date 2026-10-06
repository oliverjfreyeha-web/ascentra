/**
 * L5: how the pages read the Mentor allowance parts of the billing and Guardian APIs: each reader takes a response body
 * exactly as the route sends it and returns the typed value, or null when the shape isn't the one expected.
 * tests/unit/mentor-allowance.test.ts and tests/integration/mentor-allowance.test.ts pass the real routes' answers
 * through every reader.
 */
export type AddonCents = 0 | 500 | 1000 | 2000;
export type AllowanceView = {
  status: "exempt" | "none" | "active" | "used_up"; addonCents: number; nextAddonCents: number; usableUsd: number; usedUsd: number;
  resetsAt: string | null; trial: boolean; line: string | null;
};
export type MentorAddonInfo = {
  available: boolean; canChange: boolean; choices: { basic: AddonCents[]; pro: AddonCents[] }; reservePercent: number; trialAllowanceCents: number;
  allowance: AllowanceView; terms: { title: string; version: string; body: string };
};
export type AddonQuote = {
  amountCents: AddonCents; previousCents: number; effect: "now" | "renewal" | "conversion"; chargeTodayCents: number;
  nextChargeCents: number; nextChargeAt: string | null; usableFrom: string | null; disclosure: string; termsVersion: string;
};
export type TeenAllowance = AllowanceView & { choices: AddonCents[] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
const cents = (v: unknown) => Array.isArray(v) && v.every((c) => c === 0 || c === 500 || c === 1000 || c === 2000);

const isAllowance = (a: unknown): a is AllowanceView =>
  obj(a) && str(a.status) && num(a.addonCents) && num(a.nextAddonCents) && num(a.usableUsd) && num(a.usedUsd) && typeof a.trial === "boolean"
  && (a.line === null || str(a.line)) && (a.resetsAt === null || str(a.resetsAt));

/** GET /api/v1/billing → its mentorAddon part. */
export function mentorAddonFrom(body: unknown): MentorAddonInfo | null {
  const m = obj(body) ? body.mentorAddon : null;
  return obj(m) && typeof m.available === "boolean" && typeof m.canChange === "boolean" && obj(m.choices) && cents(m.choices.basic) && cents(m.choices.pro)
    && num(m.reservePercent) && num(m.trialAllowanceCents) && isAllowance(m.allowance) && obj(m.terms) && str(m.terms.version) && str(m.terms.body)
    ? (m as unknown as MentorAddonInfo) : null;
}

/** POST /api/v1/billing/mentor-addon without confirm → the quote. */
export function addonQuoteFrom(body: unknown): AddonQuote | null {
  const q = obj(body) ? body.quote : null;
  return obj(q) && num(q.amountCents) && num(q.previousCents) && (q.effect === "now" || q.effect === "renewal" || q.effect === "conversion")
    && num(q.chargeTodayCents) && num(q.nextChargeCents) && str(q.disclosure) && str(q.termsVersion) ? (q as unknown as AddonQuote) : null;
}

/** POST /api/v1/billing/mentor-addon with confirm → what changed. */
export function addonChangeFrom(body: unknown): { amountCents: number; effect: AddonQuote["effect"]; chargedTodayCents: number } | null {
  const c = obj(body) ? body.mentorAddon : null;
  return obj(c) && num(c.amountCents) && str(c.effect) && num(c.chargedTodayCents) ? (c as unknown as { amountCents: number; effect: AddonQuote["effect"]; chargedTodayCents: number }) : null;
}

/** GET /api/v1/guardian → each teen's Mentor allowance (null when the Guardian doesn't pay for a live plan). */
export function teenAllowancesFrom(body: unknown): Record<string, TeenAllowance | null> | null {
  if (!obj(body) || !Array.isArray(body.teens)) return null;
  const out: Record<string, TeenAllowance | null> = {};
  for (const t of body.teens) {
    if (!obj(t) || !str(t.id) || !("mentorAllowance" in t)) return null;
    const a = t.mentorAllowance;
    if (a !== null && !(isAllowance(a) && cents((a as Obj).choices))) return null;
    out[t.id] = a as TeenAllowance | null;
  }
  return out;
}

export const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
export const addonName = (c: number) => (c ? `${usd(c)} per month` : "None");
