/**
 * B2 age rules (pure). US only; minimum age 14; 14 to 17 is a teen who needs a verified Guardian; 18+ is an adult.
 * Ages are counted on today's date in the westernmost US time zone (UTC-11), so a birthday never counts early
 * anywhere in the US. The database applies the same rule (0009: private.us_today, private.age_on).
 */
export const MIN_AGE = 14;
export const ADULT_AGE = 18;
export const AGE_TIME_ZONE = "Pacific/Pago_Pago";

export type Ymd = { y: number; m: number; d: number };
export type AgeGroup = "under_minimum" | "teen" | "adult";

/** A strict YYYY-MM-DD that is a real calendar date, from 1900 up to today. Anything else is null. */
export function parseDob(value: unknown, today: Ymd): Ymd | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  if (y > today.y || (y === today.y && (mo > today.m || (mo === today.m && d > today.d)))) return null;
  return { y, m: mo, d };
}

/** Today's date where it is earliest in the US. */
export function usToday(now = new Date()): Ymd {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: AGE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now).split("-").map(Number);
  return { y, m, d };
}

/** Whole years: a Feb 29 birthday counts on Mar 1 in other years (as Postgres's age() does). */
export function ageOn(dob: Ymd, today: Ymd): number {
  let age = today.y - dob.y;
  if (today.m < dob.m || (today.m === dob.m && today.d < dob.d)) age--;
  return age;
}

export function ageGroup(age: number): AgeGroup {
  return age < MIN_AGE ? "under_minimum" : age < ADULT_AGE ? "teen" : "adult";
}

export const isoDate = ({ y, m, d }: Ymd) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
