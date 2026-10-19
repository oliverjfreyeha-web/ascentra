/**
 * Design rebuild D4: TEST DATA for the Home and Library component tests and screenshots. Shaped exactly like the API
 * answers the pages read (GET /api/v1/learn/courses and /api/v1/learn/progress); no real learner, no income claims.
 */
const lesson = (id: string, title: string, done: boolean, minutes = 8) => ({ id, title, minutes, lastVerifiedOn: "2026-10-01", done, updated: false });

export const COURSES = {
  courses: [
    { slug: "cold-outreach", name: "Cold outreach", version: 3, modules: [
      { title: "Basics and rules", pace: "About a week", lessons: [lesson("00000000-0000-4000-8000-0000000000a1", "What a first message is for", true), lesson("00000000-0000-4000-8000-0000000000a2", "The rules that apply", true)] },
      { title: "Cold email", lessons: [lesson("00000000-0000-4000-8000-0000000000a3", "Writing a short cold email", true), lesson("00000000-0000-4000-8000-0000000000a4", "One small ask", false)] },
      { title: "Messages, calls and video", lessons: [lesson("00000000-0000-4000-8000-0000000000a5", "Choosing the channel", false)] },
    ] },
    { slug: "copywriting", name: "Copywriting", version: 1, modules: [
      { title: "Hooks", lessons: [lesson("00000000-0000-4000-8000-0000000000b1", "What a hook does", false), lesson("00000000-0000-4000-8000-0000000000b2", "Testing two hooks", false)] },
      { title: "Offers", lessons: [lesson("00000000-0000-4000-8000-0000000000b3", "A clear offer", false)] },
    ] },
    { slug: "short-form-video", name: "Short-form video", version: 2, modules: [
      { title: "Scripts", lessons: [lesson("00000000-0000-4000-8000-0000000000c1", "A 30-second script", true)] },
      { title: "Filming", lessons: [lesson("00000000-0000-4000-8000-0000000000c2", "Light and sound", true)] },
    ] },
  ],
};

const mod = (position: number, title: string, state: "open" | "half" | "locked", doneCount: number, itemCount: number, reason: string | null = null) =>
  ({ position, title, state, reason, gated: state === "locked", done: doneCount === itemCount, doneCount, itemCount, round: 1 });

export const PROGRESS = {
  rank: { index: 2, name: "Explorer", points: 14, next: { name: "Builder", needs: 11 } },
  streak: { current: 3, longest: 6 },
  plan: "basic",
  courses: [
    { courseId: "00000000-0000-4000-8000-000000000c01", slug: "cold-outreach", name: "Cold outreach", kind: "skill", pickStatus: "active", tier: "Standard", plan: "basic",
      percent: 38, done: 6, items: 16, complete: false, bonus: false, capstone: null, points: 14, skillRank: { index: 2, name: "Explorer" },
      modules: [
        mod(1, "Basics and rules", "open", 4, 4),
        mod(2, "Cold email", "open", 2, 4),
        mod(3, "Messages, calls and video", "open", 0, 3),
        mod(4, "Warming it up", "locked", 0, 3, "Opens when you reach Builder."),
        mod(5, "Tracking and testing", "locked", 0, 2, "Opens when you reach Operator."),
      ],
      track: null },
  ],
  pastCourses: [],
  skills: [{ slug: "cold-outreach", name: "Cold outreach", percent: 38, rank: { index: 2, name: "Explorer" } }],
  scores: [],
  pointsByDay: [{ day: "2026-10-17", points: 4 }, { day: "2026-10-18", points: 6 }, { day: "2026-10-19", points: 4 }],
  timeZone: "America/New_York",
  note: "Ranks and streaks come from items you finish. Results vary. Nothing here promises income.",
  pointsFor: { shouldKnow: 1, important: 2, veryImportant: 3 },
};
