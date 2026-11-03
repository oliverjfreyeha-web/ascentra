import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adultOn, daysUntilAdult, pickWarning } from "@/lib/age-up-rules";
import type { Ymd } from "@/lib/age";

const ymd = (s: string): Ymd => {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
};

describe("18th-birthday switch · rules", () => {
  const dob = ymd("2008-11-20"); // turns 18 on 2026-11-20

  it("is not due more than 30 days before", () => {
    expect(daysUntilAdult(dob, ymd("2026-10-20"))).toBeNull();
    expect(pickWarning(dob, ymd("2026-10-20"))).toBeNull();
  });

  it("sends the 30-day warning from 30 down to 8 days before", () => {
    expect(daysUntilAdult(dob, ymd("2026-10-21"))).toBe(30);
    expect(pickWarning(dob, ymd("2026-10-21"))).toBe("30");
    expect(pickWarning(dob, ymd("2026-11-12"))).toBe("30"); // 8 days
  });

  it("sends the 7-day warning from 7 days down to 1 day before", () => {
    expect(pickWarning(dob, ymd("2026-11-13"))).toBe("7"); // 7 days
    expect(pickWarning(dob, ymd("2026-11-19"))).toBe("7"); // 1 day
  });

  it("sends no warning on the day or after (the switch itself runs)", () => {
    expect(pickWarning(dob, ymd("2026-11-20"))).toBeNull();
    expect(pickWarning(dob, ymd("2026-12-01"))).toBeNull();
  });

  it("names the birthday date", () => {
    expect(adultOn(dob, ymd("2026-11-05"))).toBe("2026-11-20");
    expect(adultOn(dob, ymd("2026-11-20"))).toBeNull();
  });

  it("counts a Feb 29 birthday on Mar 1 in a non-leap year, like the database", () => {
    const leap = ymd("2008-02-29"); // 18th year is 2026, not a leap year
    expect(pickWarning(leap, ymd("2026-02-28"))).toBe("7");
    expect(daysUntilAdult(leap, ymd("2026-02-28"))).toBe(1);
    expect(adultOn(leap, ymd("2026-02-20"))).toBe("2026-03-01");
  });
});

describe("18th-birthday switch · migration 0024", () => {
  const sql = readFileSync("db/migrations/0024_age_up.sql", "utf8");

  it("is the only place is_minor goes from true to false", () => {
    const writers = [...sql.matchAll(/is_minor\s*=\s*false/g)];
    expect(writers).toHaveLength(1);
    expect(sql).toContain("create function public.age_up_account");
  });

  it("only switches an active teen who is 18 by the same US-date rule as sign-up", () => {
    expect(sql).toContain("private.age_on(a.date_of_birth, private.us_today()) < 18 then return 'not_yet'");
    expect(sql).toContain("if a.status <> 'active' then return 'held_status'");
  });

  it("closes the Guardian link without touching consent records", () => {
    expect(sql).toContain("withdrawal_reason = 'learner_turned_18'");
    expect(sql).not.toMatch(/consent_records/);
  });

  it("is callable by the service role only", () => {
    expect(sql).toContain("revoke all on function public.age_up_account(uuid) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.age_up_account(uuid) to service_role");
    expect(sql).toContain("grant execute on function public.age_up_candidates() to service_role");
  });

  it("adds the two notice kinds and keeps the old ones", () => {
    expect(sql).toContain("'turning_18_notice', 'turned_18'");
    for (const k of ["trial_ending", "renewal_upcoming", "payment_failed", "mentor_allowance_100"]) expect(sql).toContain(`'${k}'`);
  });
});

describe("18th-birthday switch · wiring", () => {
  it("runs once a day from vercel.json", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(v.crons.filter((c) => c.path === "/api/cron/age-up")).toHaveLength(1);
  });

  it("the cron route checks the secret", () => {
    const src = readFileSync("app/api/cron/age-up/route.ts", "utf8");
    expect(src).toContain("timingSafeEqual");
    expect(src).toContain('status: 401');
  });

  it("the bundle for S2 is in bundles.json", () => {
    const b = JSON.parse(readFileSync("db/apply/bundles.json", "utf8")) as { bundles: Record<string, { requires: string; migrations: string[] }> };
    expect(b.bundles.S2).toEqual({ requires: "0023_skill_tracks", migrations: ["0024_age_up"] });
  });
});
