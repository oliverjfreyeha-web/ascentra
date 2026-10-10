/**
 * I1: a small, valid, clearly fake course file (format version 1) for the import tests. Every link is on example.org,
 * every title says "Test", and nothing here is a real course. docs/COURSE-IMPORT.md shows the same file as its sample
 * (tests/unit/course-import.test.ts checks they stay the same).
 */
export function sampleCourse(topicSlug = "graphic-design") {
  const mod = (n: number) => ({
    number: n,
    title: `Test module ${n}: practice basics`,
    difficulty: n,
    bigQuestion: `Test question ${n}: what makes a simple design clear?`,
    canDo: [`Test: explain idea ${n} in plain words`],
    hours: 5,
    keyTerms: ["Test term"],
    examples: ["Test example: a one-page flyer for a fictional bakery."],
    mistakes: ["Test mistake: too many fonts on one page."],
    sourceIds: ["s1"],
    recipe: { videos: 1, quizzes: 1, assignments: 1, sandboxes: 1, sequences: 1, boosters: [] },
    lessons: [{
      title: `Test lesson ${n}`,
      minutes: 10,
      summary: "Test summary: a short overview of the lesson.",
      sections: [{ heading: "Test section", paragraphs: [{ text: "Test paragraph: keep one clear message per page.", sourceIds: ["s1"] }] }],
      takeaways: [{ text: "Test takeaway: fewer fonts read better.", sourceIds: ["s1"] }],
    }],
    items: [
      {
        kind: "video", title: `Test video ${n}`, importance: "important", sourceIds: ["s1"],
        videoBrief: { mustCover: ["Test point: what a clear layout looks like"], lengthMinutes: 5, tone: "Plain and friendly", onScreenExamples: ["Test flyer"], sourceIds: ["s1"], avoid: ["Test: brand names"] },
      },
      {
        kind: "quiz", title: `Test quiz ${n}`, taskType: "multiple_choice", importance: "very_important", sourceIds: ["s1"],
        notebookNote: "Test note: one clear message per page reads better than three.",
        prompt: "Test question: how many main messages should a flyer have?", content: { options: ["One", "Five"] }, answerKey: { correct: 0 },
        explanation: "Test explanation: one main message is easier to read.",
      },
      {
        kind: "assignment", title: `Test assignment ${n}`, taskType: "short_answer", importance: "should_know", sourceIds: ["s1"],
        prompt: "Test task: describe a flyer you would make for a fictional bakery.", content: { sampleAnswer: "Test sample: one headline, one image, the opening hours." },
        explanation: "Test explanation: a clear flyer has one headline.",
      },
      {
        kind: "sandbox", title: `Test sandbox ${n}`, taskType: "spot_the_mistake", importance: "important", sourceIds: ["s1"],
        prompt: "Test task: find the mistake in this made-up flyer text.", content: { passage: "Test passage: GRAND OPENING!!! Sale sale sale, call now now now.", mistake: "Test: shouting and repetition hide the message." },
        explanation: "Test explanation: repetition hides the message.",
      },
      {
        kind: "sequence", title: `Test sequence ${n}`, taskType: "ordering", importance: "should_know", sourceIds: ["s1"],
        prompt: "Test task: put the steps of making a flyer in order.", content: { steps: ["Pick one message", "Sketch the layout", "Choose one font"] }, answerKey: { order: [0, 1, 2] },
        explanation: "Test explanation: the message comes first.",
      },
    ],
  });
  return {
    formatVersion: 1,
    topicSlug,
    course: {
      title: "Test import course (fake example)",
      sizeTier: "compact",
      hoursPerWeek: { min: 4, max: 6 },
      roadmap: "Test roadmap: three short modules, from layout basics to a first practice piece.",
      audience: "Test audience: complete beginners.",
      teenStatus: { status: "open", reason: "Test: no adult accounts or money involved." },
      outcomes: ["Test outcome: make a clear one-page design for practice."],
      requirements: { ageLimits: "Test: none beyond the site's.", licenses: "Test: none for practice." },
      legalChecklist: ["Test: use only images you have the right to use."],
      notices: { software: "Test notice: some design tools have free and paid plans. This is general information." },
      marketing: "Test marketing notes.",
      growth: ["Test growth step: build a small practice portfolio."],
      glossary: [{ term: "Test layout", meaning: "Test meaning: how things are arranged on the page." }],
      toolsAndCosts: [{ tool: "Test design tool", what: "Test: makes layouts", cost: "free", link: "https://example.org/test-tool", checkedOn: "2026-10-01" }],
      commonMistakes: ["Test: too many fonts."],
      skillsTaught: [],
      coverageChecklist: ["Test: layout", "Test: fonts"],
    },
    sources: [{ id: "s1", kind: "article", title: "Test design basics article", link: "https://example.org/test-design-basics", creditLine: "Test credit: Example Org", licenseClass: "web_summarize_only" }],
    resources: [
      { name: "Test checklist", link: "https://example.org/test-checklist", license: "Test license", termsChecked: true, okToUseText: true, checkedOn: "2026-10-01" },
      { name: "Test unchecked resource", link: "https://example.org/test-unchecked", license: "Unknown", termsChecked: false, okToUseText: false, checkedOn: "2026-10-01" },
    ],
    freshnessWatch: [{ what: "Test: tool prices", link: "https://example.org/test-tool", howOften: "monthly" }],
    capstone: {
      title: "Test capstone: a practice flyer",
      deliverables: ["Test: one practice flyer for a fictional business"],
      selfCheck: ["Test: one main message", "Test: two fonts at most"],
      automation: {
        whatAutomated: "Test: drafting three headline options to choose from.",
        masterPrompts: [{ title: "Test headline helper", purpose: "Test: suggest three short headlines for a practice flyer." }],
        aiPlans: [],
      },
    },
    modules: [mod(1), mod(2), mod(3)],
  };
}
export type SampleCourse = ReturnType<typeof sampleCourse>;
