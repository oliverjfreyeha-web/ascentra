/**
 * C1: a v2 outline from the model, made safe before anyone sees it: 5 or 6 modules kept, each recipe brought within the
 * caps (unknown boosters dropped), one brief per video in the recipe, each brief point citing the source behind the
 * passages it named (or none, marked). And a drafted practice item's place in the recipe: the part the model gave when
 * the item's type fits it, else the type's usual part. Pure; test-only data.
 */
import { describe, expect, it } from "vitest";
import { toPlan } from "@/lib/courses/blueprint";
import { partOf } from "@/lib/activities/draft";

const passages = [
  { n: 1, sourceId: "src-a", claimId: null, quote: "Test quote A", text: "Test passage A." },
  { n: 2, sourceId: "src-b", claimId: null, quote: "Test quote B", text: "Test passage B." },
] as never;
const lesson = { title: "Test lesson", minutes: 10, objectives: ["Test objective"], keyClaims: [{ claim: "Test claim", passages: [1] }] };
const moduleOf = (i: number, recipe: unknown, videos: unknown[]) => ({ title: `Test module ${i}`, stage: "Foundations", lessons: [lesson], skills: [{ name: `Skill ${i}` }], recipe, videos });
const video = (title: string, points: { text: string; passages: number[] }[]) => ({ title, purpose: "Test purpose", points, targetMinutes: 40, tone: "Plain", onScreen: ["A made-up inbox"], avoid: ["Real names"] });
const v2 = { boosters: ["teach-it-back", "weekly-reflection"], titles: new Map([["src-a", "Source A"], ["src-b", "Source B"]]) };

describe("a v2 outline", () => {
  it("keeps the recipe within the caps, drops unknown boosters, and gives every video in the recipe a brief", () => {
    const g = { title: "Test course", outcome: "Test outcome", modules: [
      moduleOf(1, { videos: 9, quizzes: 0, assignments: 2, sandboxes: 1, sequences: 1, boosters: ["teach-it-back", "made-up", "teach-it-back"] }, [video("Intro", [{ text: "Point one", passages: [1, 2] }, { text: "Point two", passages: [] }])]),
      ...[2, 3, 4, 5].map((i) => moduleOf(i, { videos: 1, quizzes: 2, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] }, [video(`Video ${i}`, [{ text: "Point", passages: [2] }])])),
    ] };
    const plan = toPlan(g as never, passages, v2);
    expect(plan.structure).toBe(2);
    expect(plan.modules).toHaveLength(5);
    const m1 = plan.modules[0];
    expect(m1.recipe).toEqual({ videos: 4, quizzes: 1, assignments: 2, sandboxes: 1, sequences: 1, boosters: ["teach-it-back"] });
    expect(m1.videos).toHaveLength(4);
    expect(m1.videos![0]).toMatchObject({ title: "Intro", brief: { targetMinutes: 15, points: [
      { text: "Point one", sources: [{ sourceId: "src-a", title: "Source A" }, { sourceId: "src-b", title: "Source B" }] },
      { text: "Point two", sources: [] },
    ] } });
    expect(m1.videos![3]).toEqual({ title: "Explainer video 4", brief: { points: [] } });
  });
  it("a v1 outline has no recipe or briefs", () => {
    const plan = toPlan({ title: "T", outcome: "O", modules: [moduleOf(1, undefined, [])] } as never, passages);
    expect(plan.structure).toBeUndefined();
    expect(plan.modules[0].recipe).toBeUndefined();
  });
});

describe("a drafted item's part of the recipe", () => {
  const boosters = [{ key: "teach-it-back", itemTypes: ["teach_back"] }];
  it("the part the model gave, when the type fits", () => {
    expect(partOf("spot_the_mistake", "sandbox", undefined, boosters)).toEqual({ recipe_part: "sandbox", booster_key: null });
    expect(partOf("teach_back", "booster", "teach-it-back", boosters)).toEqual({ recipe_part: "booster", booster_key: "teach-it-back" });
  });
  it("otherwise the type's usual part (a quiz type is never a sandbox; a booster must be in the module's recipe and fit)", () => {
    expect(partOf("multiple_choice", "sandbox", undefined, boosters)).toEqual({ recipe_part: "quiz", booster_key: null });
    expect(partOf("short_answer", "booster", "teach-it-back", boosters)).toEqual({ recipe_part: "assignment", booster_key: null });
    expect(partOf("teach_back", "booster", "made-up", boosters).booster_key).toBeNull();
  });
});
