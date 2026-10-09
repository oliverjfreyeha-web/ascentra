/**
 * C1: the Owner's approval rules as the studio explains them (the database holds the same rules, tested in
 * tests/db/course-structure.test.ts): what keeps a module from being ready, when an approval still counts (exactly the
 * versions and items shown, made after their last submission and verification), the income-claims findings with where
 * each one is, and the review label a learner sees. Test-only data.
 */
import { describe, expect, it } from "vitest";
import { candidateOf, incomeFindings, moduleState, type Loaded } from "@/lib/courses/owner-review";
import { reviewLabel } from "@/app/studio-api";

const T = (h: number) => `2026-10-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const body = (text: string) => ({ summary: "Test summary.", sections: [{ heading: "Test", paragraphs: [{ text, refs: [1] }] }], takeaways: [] });
const mod = { id: "m1", course_id: "c1", position: 1, title: "Test module 1", stage: null, recipe: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] }, recommended_pace: "About 1 week" };
const version = (id: string, lesson: string, over: Record<string, unknown> = {}) => ({
  id, lesson_id: lesson, version: 1, status: "review", title: "Test lesson", body: body("Write a first line about their own work."),
  submitted_at: T(9), verified_at: T(10), verified_by_account_id: "rev", returned_note: null, published_at: null, ...over,
});
const item = (id: string, type: string, part: string) => ({ id, lesson_id: "l1", module_id: "m1", status: "approved", item_type: type, recipe_part: part, booster_key: null, prompt: "Test prompt?", content: {}, explanation: "Test.", reviewed_at: T(8) });
const ITEMS = [item("i1", "multiple_choice", "quiz"), item("i2", "short_answer", "assignment"), item("i3", "spot_the_mistake", "sandbox"), item("i4", "ordering", "sequence")];
const slot = { id: "s1", module_id: "m1", lesson_id: null, position: 1, title: "Test video", brief: { points: [{ text: "Test point" }] }, brief_generated_by: "ai", status: "waiting", current_upload_id: null, transcript: null, approved_at: null, approved_by_account_id: null, brief_edited_at: null };
const loaded = (over: Partial<Record<keyof Loaded, unknown[]>> = {}): Loaded => ({
  modules: [mod], lessons: [{ id: "l1", module_id: "m1", position: 1, title: "Test lesson", minutes: 10 }],
  versions: [version("v1", "l1")], items: ITEMS, slots: [slot], uploads: [], reviews: [], ...over,
} as unknown as Loaded);
const approval = (over: Record<string, unknown> = {}) => ({ id: "r1", seq: 1, module_id: "m1", decision: "approved", note: null, lesson_version_ids: ["v1"], item_ids: ["i1", "i2", "i3", "i4"], decided_by_account_id: "owner", decided_at: T(11), ...over });
const state = (l: Loaded) => moduleState(l, mod as never, incomeFindings(l));

describe("when a module is ready for the Owner", () => {
  it("not before every lesson has a Reviewer-verified version, every core part a reviewed item, and 3 kinds of practice", () => {
    const st = state(loaded({ versions: [version("v1", "l1", { verified_by_account_id: null, verified_at: null })], items: ITEMS.slice(0, 2) }));
    expect(st.ready).toBe(false);
    expect(st.blockers).toEqual([
      'Lesson "Test lesson": waiting for a Reviewer\'s verification.',
      "No reviewed sandbox item yet.", "No reviewed interactive sequence item yet.",
      "Practice needs at least 3 different activity types (it has 2).",
    ]);
    expect(state(loaded({ versions: [] })).blockers[0]).toBe('Lesson "Test lesson": not drafted yet.');
  });
  it("ready: the verified version and the reviewed items are what an approval covers", () => {
    const st = state(loaded());
    expect(st).toMatchObject({ ready: true, blockers: [], candidates: ["v1"], itemIds: ["i1", "i2", "i3", "i4"], review: null });
    expect(st.coverage).toMatchObject({ missing: [], types: 4, varietyOk: true });
  });
  it("a published version counts when there's nothing newer in review", () => {
    expect(candidateOf([version("v0", "l1", { status: "published" })] as never, "l1")?.id).toBe("v0");
    expect(candidateOf([version("v0", "l1", { status: "published" }), version("v1", "l1", { version: 2 })] as never, "l1")?.id).toBe("v1");
  });
});

describe("whether an approval still counts", () => {
  it("yes for exactly these versions and items, decided after the last verification", () => {
    expect(state(loaded({ reviews: [approval()] })).review).toMatchObject({ decision: "approved", current: true });
  });
  it("no when the version was verified again after the decision", () => {
    expect(state(loaded({ reviews: [approval({ decided_at: T(9) })] })).review?.current).toBe(false);
  });
  it("no when a new practice item was reviewed after it", () => {
    expect(state(loaded({ reviews: [approval()], items: [...ITEMS, item("i5", "true_false", "quiz")] })).review?.current).toBe(false);
  });
  it("no when it was for another version; a send-back is never an approval", () => {
    expect(state(loaded({ reviews: [approval({ lesson_version_ids: ["v-old"] })] })).review?.current).toBe(false);
    expect(state(loaded({ reviews: [approval({ decision: "sent_back", note: "Test note", lesson_version_ids: [], item_ids: [] })] })).review).toMatchObject({ decision: "sent_back", note: "Test note", current: false });
  });
});

describe("the income-claims check in a course version", () => {
  it("says exactly what and where, and blocks the module", () => {
    const l = loaded({ versions: [version("v1", "l1", { body: body("Follow these steps and you will earn $5,000 a month.") })] });
    const f = incomeFindings(l);
    expect(f.map((x) => [x.where, x.text])).toEqual([
      ['Module 1 "Test module 1" › lesson "Test lesson" v1 › section 1 "Test" › paragraph 1', "earn $5,000"],
      ['Module 1 "Test module 1" › lesson "Test lesson" v1 › section 1 "Test" › paragraph 1', "you will earn"],
    ]);
    expect(state(l).blockers).toContain("The income-claims check found 2 place(s) to reword.");
  });
  it("checks video briefs and transcripts too, and leaves prices for a service alone", () => {
    const l = loaded({ slots: [{ ...slot, brief: { points: [{ text: "Charge $500 a month for the retainer." }] }, transcript: "Some students quit their day job." }] });
    expect(incomeFindings(l).map((x) => x.where)).toEqual(['Module 1 "Test module 1" › video "Test video" › transcript']);
  });
});

describe("the review label a learner sees", () => {
  it('"Reviewed by the Owner on {date}" only with the approval record; otherwise the ASCENTRA reviewer line, or nothing', () => {
    expect(reviewLabel({ by: "owner", date: "2026-10-02T15:00:00.000Z" }, "en-US")).toBe("Reviewed by the Owner on 10/2/2026");
    expect(reviewLabel({ by: "reviewer" })).toBe("Reviewed by an ASCENTRA reviewer");
    expect(reviewLabel(null)).toBeNull();
  });
});
