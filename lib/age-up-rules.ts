import { ageOn, type Ymd } from "@/lib/age";

/**
 * S2: the pure rules of the 18th-birthday switch (no database, so they are unit-tested directly).
 * The warning days are the Owner's choice (30 and 7 days before), recorded on Oct 29, 2026.
 */
export const AGE_UP_WARNING_DAYS = { early: 30, late: 7 } as const;
export type WarningWindow = "30" | "7";

const addDays = ({ y, m, d }: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** Days from `today` until the learner counts as 18 (0 = today; null = more than 30 days away or already 18+). */
export function daysUntilAdult(dob: Ymd, today: Ymd): number | null {
  if (ageOn(dob, today) >= 18) return null;
  for (let k = 1; k <= AGE_UP_WARNING_DAYS.early; k++) if (ageOn(dob, addDays(today, k)) >= 18) return k;
  return null;
}

/**
 * Which warning is due: "30" while the 18th birthday is 8 to 30 days away, "7" while it is 1 to 7 days away.
 * Each window is sent once (the notice's dedupe key), so a missed day still gets its warning the next day.
 */
export function pickWarning(dob: Ymd, today: Ymd): WarningWindow | null {
  const k = daysUntilAdult(dob, today);
  if (k === null) return null;
  return k <= AGE_UP_WARNING_DAYS.late ? "7" : "30";
}

/** The date the learner first counts as 18 (an ISO date), when it is within the warning range. */
export function adultOn(dob: Ymd, today: Ymd): string | null {
  const k = daysUntilAdult(dob, today);
  if (k === null) return null;
  const { y, m, d } = addDays(today, k);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
