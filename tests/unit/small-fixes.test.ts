/**
 * Small fixes (docs/small-fixes-audit.md, Owner answers 1 to 3): the trial label reads its length and Basic's price from
 * lib/billing-terms.ts; the payment-failed banner says "Billing" and opens that section; Home's account line takes its
 * admin links from app/admin-links.ts (each role keeps exactly the links it had) and adds Progress; Account's breadcrumb
 * links Learn and My progress for everyone but Guardians.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planLabel } from "@/app/billing-api";
import { adminLinksFor } from "@/app/admin-links";
import { PLANS, TRIAL_DAYS } from "@/lib/billing-terms";
import type { RoleKey } from "@/lib/caps";

const plans = Object.entries(PLANS).map(([key, p]) => ({ key, name: p.name, cents: p.cents }));

describe("Account → Billing plan label", () => {
  it("the trial: its days and Basic's price come from the billing terms (14 days, then Basic at $20/mo)", () => {
    expect(planLabel("trial", TRIAL_DAYS, plans)).toBe("14-day free trial, then Basic ($20/mo)");
    expect(planLabel("trial", 7, [{ key: "basic", cents: 2500 }])).toBe("7-day free trial, then Basic ($25/mo)");
    expect(planLabel("basic", TRIAL_DAYS, plans)).toBe("Basic");
    expect(planLabel("pro", TRIAL_DAYS, plans)).toBe("Pro");
  });
  it("the locked prices are unchanged: Basic $20, Pro $50, a 14-day trial", () => {
    expect(PLANS.basic.cents).toBe(2000);
    expect(PLANS.pro.cents).toBe(5000);
    expect(TRIAL_DAYS).toBe(14);
  });
  it("the panel uses the label, has no typed trial length, and its section is #billing", () => {
    const panel = readFileSync("app/account/billing-panel.tsx", "utf8");
    expect(panel).toMatch(/planLabel\(s\.plan, data\.trialDays, data\.plans\)/);
    expect(panel).not.toMatch(/14-day/);
    expect(panel).toMatch(/<section aria-labelledby="billing-h" className="ui-block" id="billing">/);
    expect(panel).toMatch(/<h2 id="billing-h">Billing<\/h2>/);
  });
  it("the payment-failed banner says Billing (the section's name) and goes to the section", () => {
    expect(readFileSync("app/billing-banner.tsx", "utf8")).toMatch(/"Guardian Center" : "Billing"/);
    const alerts = readFileSync("app/api/v1/billing/alerts/route.ts", "utf8");
    expect(alerts.match(/"\/account#billing"/g)).toHaveLength(2);
    expect(alerts).not.toMatch(/"\/account"/);
  });
});

describe("Home account line", () => {
  // What each role's line showed before this change (docs/small-fixes-audit.md §3), plus the two Owner pages the
  // admin home already listed. No role gains a page it couldn't already open from /admin.
  const BEFORE: Record<RoleKey, string[]> = {
    owner: ["/admin/audit", "/admin/safety", "/admin/style-guide", "/admin/sources", "/admin/courses", "/admin/catalog", "/admin/review", "/admin/course-requests", "/admin/topics", "/admin/security"],
    superAdmin: ["/admin/audit", "/admin/safety", "/admin/style-guide", "/admin/sources", "/admin/courses", "/admin/topics", "/admin/security"],
    courseAdmin: ["/admin/sources", "/admin/courses", "/admin/catalog", "/admin/course-requests", "/admin/topics"],
    reviewer: ["/admin/sources", "/admin/courses", "/admin/catalog"],
    support: ["/admin/security"],
    guardian: [],
    learner: [],
  };
  it("each role keeps exactly its links; the Owner also gets Import course and Missions, as on /admin", () => {
    for (const [role, hrefs] of Object.entries(BEFORE) as [RoleKey, string[]][]) {
      const now = adminLinksFor(role).map((l) => l.href).sort();
      const expected = role === "owner" ? [...hrefs, "/admin/import", "/admin/missions"] : hrefs;
      expect(now, role).toEqual([...expected].sort());
    }
  });
  it("renders adminLinksFor and adds Progress beside Learn and My path (not for Guardians)", () => {
    const panel = readFileSync("app/account-panel.tsx", "utf8");
    expect(panel).toMatch(/adminLinksFor\(me\.roleKey\)\.map/);
    expect(panel).not.toMatch(/href="\/admin\//); // no hand-written admin links left to drift
    expect(panel).toMatch(/me && me\.roleKey !== "guardian" && \(\s*<>\s*<Link href="\/learn">Learn<\/Link> · <Link href="\/learn\/path">My path<\/Link> · <Link href="\/learn\/choose">Choose your path<\/Link> · <Link href="\/learn\/progress">Progress<\/Link>/);
  });
});

describe("Account breadcrumb", () => {
  it("links Learn and My progress, for everyone but Guardians, once the account is known", () => {
    expect(readFileSync("app/account/page.tsx", "utf8")).toMatch(/<Link href="\/">Home<\/Link> · <LearnCrumbs \/><SignOut \/>/);
    const crumbs = readFileSync("app/account/learn-crumbs.tsx", "utf8");
    expect(crumbs).toMatch(/if \(state\.status !== "ready" \|\| state\.me\.roleKey === "guardian"\) return null;/);
    expect(crumbs).toMatch(/<Link href="\/learn">Learn<\/Link> · <Link href="\/learn\/progress">My progress<\/Link>/);
  });
});
