/**
 * C2, the pure rules: side-hustle picks on each plan, the topic facts (cost, outlook) with the income check, the skill
 * overlap note, teen missions branch by branch, leaderboard nicknames and practice rivals, and the capstone check.
 * The same pick rules run in SQL; those (with parallel picks and row-level security) are tested in tests/db/progress-paths.test.ts.
 */
import { describe, expect, it } from "vitest";
import { applyPause, applyPick, reconcile, type PickRow, type TopicRow } from "@/lib/picks/rules";
import { ESTIMATE_COMING, OVERLAP_NOTE, cardFacts, checkFacts, overlapNote } from "@/lib/picks/topic-facts";
import { decideMission } from "@/lib/missions";
import { RIVAL_LABEL, checkNickname, practiceRivals, weekOf } from "@/lib/leaderboard-rules";
import { PAID_PLAN_NOTE, checkCapstone } from "@/lib/courses/capstone";

const T = (id: string, kind: TopicRow["kind"], extra: Partial<TopicRow> = {}): TopicRow =>
  ({ id, kind, slug: id, published: true, teen_hidden: false, has_course: false, ...extra });
const TOPICS = [
  T("b1", "business"), T("b2", "business"), T("h1", "side_hustle"), T("h2", "side_hustle"), T("h3", "side_hustle", { teen_hidden: true }),
  T("s1", "skill"), T("s2", "skill"), T("s3", "skill"), T("s4", "skill"), T("s5", "skill"),
];
const at = (n: number) => `2026-10-0${n}T10:00:00Z`;

describe("side-hustle picks", () => {
  it("Basic and trial: a side hustle without a business, then it locks", () => {
    for (const plan of ["basic", "trial"] as const) {
      const picks: PickRow[] = [];
      expect(applyPick(picks, TOPICS, "h1", "u", plan, false, at(1))).toMatchObject({ result: "picked", kind: "side_hustle" });
      expect(picks[0].locked).toBe(true);
      expect(applyPick(picks, TOPICS, "h2", "u", plan, false, at(2))).toMatchObject({ result: "locked", kind: "side_hustle", current: "h1" });
      expect(applyPause(picks, TOPICS, "h1", plan, false)).toEqual({ result: "locked" });
      // A business is still allowed alongside, and locks separately.
      expect(applyPick(picks, TOPICS, "b1", "u", plan, false, at(3))).toMatchObject({ result: "picked", kind: "business" });
      expect(applyPick(picks, TOPICS, "b2", "u", plan, false, at(4))).toMatchObject({ result: "locked", kind: "business" });
    }
  });

  it("Basic: 3 skills, 1 business and 1 side hustle together", () => {
    const picks: PickRow[] = [];
    for (const [i, id] of ["b1", "h1", "s1", "s2", "s3"].entries()) expect(applyPick(picks, TOPICS, id, "u", "basic", false, at(i + 1)).result).toBe("picked");
    expect(applyPick(picks, TOPICS, "s4", "u", "basic", false, at(7))).toEqual({ result: "limit", limit: 3, used: 3 });
  });

  it("Pro: one active side hustle, switchable; the old one is paused, not lost", () => {
    const picks: PickRow[] = [];
    applyPick(picks, TOPICS, "h1", "u", "pro", false, at(1));
    expect(picks[0].locked).toBe(false);
    expect(applyPick(picks, TOPICS, "h2", "u", "pro", false, at(2))).toMatchObject({ result: "picked", previous: "h1" });
    expect(picks.find((p) => p.topic_id === "h1")?.status).toBe("paused");
    expect(picks.filter((p) => p.kind === "side_hustle" && p.status === "active")).toHaveLength(1);
    for (const [i, id] of ["s1", "s2", "s3", "s4", "s5"].entries()) expect(applyPick(picks, TOPICS, id, "u", "pro", false, at(i + 3)).result).toBe("picked");
  });

  it("Pro to Basic: keeps the business, the side hustle and the 3 newest skills (locked); pauses the rest", () => {
    const picks: PickRow[] = [];
    for (const [i, id] of ["b1", "h1", "s1", "s2", "s3", "s4", "s5"].entries()) applyPick(picks, TOPICS, id, "u", "pro", false, at(i + 1));
    expect(reconcile(picks, TOPICS, "basic", false)).toBe(2);
    const active = picks.filter((p) => p.status === "active").map((p) => p.topic_id).sort();
    expect(active).toEqual(["b1", "h1", "s3", "s4", "s5"]);
    expect(picks.filter((p) => p.kind !== "skill").every((p) => p.locked)).toBe(true);
  });

  it("teens: a teen-hidden side hustle isn't available; an existing pick of one is paused", () => {
    expect(applyPick([], TOPICS, "h3", "u", "basic", true, at(1))).toEqual({ result: "not_available" });
    const picks: PickRow[] = [{ user_id: "u", topic_id: "h3", kind: "side_hustle", status: "active", locked: true, picked_at: at(1) }];
    reconcile(picks, TOPICS, "basic", true);
    expect(picks[0]).toMatchObject({ status: "paused", locked: false });
    expect(applyPick(picks, TOPICS, "h1", "u", "basic", true, at(2)).result).toBe("picked");
  });
});

describe("topic facts", () => {
  const good = {
    costLow: 50, costHigh: 400, costItems: ["Domain", "Website builder"], costSources: [{ title: "Builder pricing page", url: "https://example.com/pricing" }],
    costCheckedOn: "2026-10-01", outlookLabel: "steady", outlookSources: [{ title: "Industry survey", url: "https://example.com/survey" }], outlookCheckedOn: "2026-09-30",
    difficulty: 3, riskNotes: "Some months bring few orders.",
  };

  it("an empty card says Estimate coming, never a made-up number", () => {
    expect(cardFacts({})).toMatchObject({ cost: null, outlook: null, empty: ESTIMATE_COMING });
    // A number without sources or a date isn't shown either.
    expect(cardFacts({ cost_low: 100, cost_sources: [], cost_checked_on: "2026-10-01" }).cost).toBeNull();
    expect(cardFacts({ outlook_label: "growing", outlook_sources: [{ title: "x", url: "https://e.com" }], outlook_checked_on: null }).outlook).toBeNull();
  });

  it("a sourced, dated estimate shows its range, date and sources", () => {
    const c = checkFacts("side_hustle", good);
    if (!("fields" in c)) throw new Error(c.problem);
    const card = cardFacts(c.fields);
    expect(card.cost).toMatchObject({ range: "$50 to $400", checkedOn: "2026-10-01", items: ["Domain", "Website builder"] });
    expect(card.outlook).toMatchObject({ label: "Steady", checkedOn: "2026-09-30" });
    expect(card.note).toBe("Estimate, not a promise.");
  });

  it("refuses skills, bad numbers, future dates, http links and bad labels", () => {
    expect(checkFacts("skill", good)).toHaveProperty("problem");
    expect(checkFacts("business", { costLow: 500, costHigh: 100 })).toHaveProperty("problem");
    expect(checkFacts("business", { costLow: -1 })).toHaveProperty("problem");
    expect(checkFacts("business", { costCheckedOn: "2999-01-01" })).toHaveProperty("problem");
    expect(checkFacts("business", { costSources: [{ title: "Pricing", url: "http://example.com" }] })).toHaveProperty("problem");
    expect(checkFacts("business", { outlookLabel: "booming" })).toHaveProperty("problem");
    expect(checkFacts("business", { difficulty: 6 })).toHaveProperty("problem");
  });

  it("the income-claims and attorney checks cover cost items, risk notes and source titles", () => {
    expect(checkFacts("business", { riskNotes: "Most people earn $5,000 a month" })).toMatchObject({ problem: expect.stringMatching(/promise income/) });
    expect(checkFacts("business", { costItems: ["Course that shows passive income"] })).toHaveProperty("problem");
    expect(checkFacts("business", { costSources: [{ title: "Guaranteed results report", url: "https://e.com" }] })).toHaveProperty("problem");
    expect(checkFacts("business", { riskNotes: "Attorney-approved steps" })).toHaveProperty("problem");
  });

  it("the overlap note is a note only", () => {
    expect(overlapNote("s1", new Set(["s1"]))).toBe(OVERLAP_NOTE);
    expect(overlapNote("s2", new Set(["s1"]))).toBeNull();
    expect(OVERLAP_NOTE).toBe("Your business course already teaches this. Picking it adds extra practice in other settings.");
  });
});

describe("teen missions", () => {
  const base = { minor: true, missionType: "public_post", state: "CA", allowedStates: ["CA"], courseApproved: true, contactApproved: false };
  it("adults need no Guardian step", () => {
    expect(decideMission({ ...base, minor: false, state: null, allowedStates: [], courseApproved: false })).toEqual({ ok: true });
  });
  it("an unknown mission type is refused for everyone", () => {
    expect(decideMission({ ...base, minor: false, missionType: "meet_in_person" })).toMatchObject({ ok: false, need: "unknown" });
  });
  it("a teen needs a state", () => expect(decideMission({ ...base, state: null })).toMatchObject({ ok: false, need: "state" }));
  it("a teen needs the state on the allow-list (off by default)", () => {
    expect(decideMission({ ...base, allowedStates: [] })).toMatchObject({ ok: false, need: "allow_list" });
    expect(decideMission({ ...base, state: "TX" })).toMatchObject({ ok: false, need: "allow_list" });
  });
  it("a teen needs the Guardian's approval for the course", () => expect(decideMission({ ...base, courseApproved: false })).toMatchObject({ ok: false, need: "course_approval" }));
  it("a mission that contacts someone needs a new approval each time", () => {
    expect(decideMission({ ...base, missionType: "contact_business" })).toMatchObject({ ok: false, need: "contact_approval" });
    expect(decideMission({ ...base, missionType: "customer_interview", contactApproved: true })).toEqual({ ok: true });
  });
  it("a no-contact mission with state, allow-list and course approval is open", () => expect(decideMission(base)).toEqual({ ok: true }));
});

describe("leaderboard", () => {
  it("nicknames: length, characters, blocklist, numbers, real name and email", () => {
    expect(checkNickname("Rocket_7", {})).toEqual({ nickname: "Rocket_7" });
    expect(checkNickname("ab", {})).toHaveProperty("problem");
    expect(checkNickname("has space", {})).toHaveProperty("problem");
    expect(checkNickname("x".repeat(21), {})).toHaveProperty("problem");
    expect(checkNickname("TheOwner1", {})).toHaveProperty("problem");
    expect(checkNickname("ki_ll_er", {})).toHaveProperty("problem");
    expect(checkNickname("call5551234567", {})).toHaveProperty("problem");
    expect(checkNickname("JordanRocks", { displayName: "Jordan Lee" })).toHaveProperty("problem");
    expect(checkNickname("sam_runs", { email: "samruns@example.com" })).toHaveProperty("problem");
  });

  it("practice rivals: labelled on every row, the same all week, different next week", () => {
    const mon = new Date("2026-10-05T12:00:00Z");
    const sun = new Date("2026-10-11T22:00:00Z");
    expect(weekOf(mon)).toBe("2026-10-05");
    expect(weekOf(sun)).toBe("2026-10-05");
    const a = practiceRivals("teen-1", 40, mon);
    expect(a).toHaveLength(8);
    expect(a.every((r) => r.simulated && r.label === RIVAL_LABEL)).toBe(true);
    expect(practiceRivals("teen-1", 40, sun)).toEqual(a);
    expect(practiceRivals("teen-1", 40, new Date("2026-10-12T12:00:00Z"))).not.toEqual(a);
    expect(new Set(a.map((r) => r.nickname)).size).toBe(8);
    expect(a.every((r) => r.points >= 0)).toBe(true);
  });
});

describe("capstone", () => {
  const plan = { name: "Tool Plus", price: "$20 a month", sourceUrl: "https://example.com/pricing", checkedOn: "2026-10-01" };
  const body = { title: "Launch plan", deliverables: ["A one-page plan"], checklist: ["I listed my first 3 steps"], automation: { what: "Drafting replies to customer emails", prompts: ["Draft a reply..."], plans: [plan] } };

  it("needs deliverables and a self-check checklist", () => {
    expect(checkCapstone({ ...body, deliverables: [] }, false)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, checklist: [] }, false)).toHaveProperty("problem");
    expect(checkCapstone({ title: "Plan", deliverables: ["x"], checklist: ["y"] }, false)).toHaveProperty("row");
  });

  it("a business course's capstone needs Automation with AI", () => {
    expect(checkCapstone({ title: "Plan", deliverables: ["x"], checklist: ["y"] }, true)).toHaveProperty("problem");
    const c = checkCapstone(body, true);
    expect(c).toMatchObject({ row: { plans_checked_on: "2026-10-01" } });
  });

  it("AI plans are Owner-entered with a price, an https source and a past date; none is fine (paid plan may be needed)", () => {
    expect(checkCapstone({ ...body, automation: { ...body.automation, plans: [{ ...plan, sourceUrl: "" }] } }, true)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, automation: { ...body.automation, plans: [{ ...plan, checkedOn: "2999-01-01" }] } }, true)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, automation: { ...body.automation, plans: [{ ...plan, price: "" }] } }, true)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, automation: { ...body.automation, plans: [] } }, true)).toMatchObject({ row: { plans_checked_on: null } });
    expect(PAID_PLAN_NOTE).toMatch(/paid plan may be needed/i);
  });

  it("the income and attorney checks cover the capstone", () => {
    expect(checkCapstone({ ...body, checklist: ["I can now make $1,000 a week"] }, true)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, automation: { ...body.automation, prompts: ["Write a post about passive income"] } }, true)).toHaveProperty("problem");
    expect(checkCapstone({ ...body, deliverables: ["A lawyer approved contract"] }, true)).toHaveProperty("problem");
  });
});
