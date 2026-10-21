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

/**
 * Design rebuild D5: TEST DATA for the Profile dashboard. A year of points per day (deterministic, ending 2026-10-19 with
 * a 3-day streak), and a second course that is a skill track with Rounds. Shaped exactly like GET /api/v1/learn/progress.
 */
export const TEST_TODAY = "2026-10-19";
function yearOfPoints(): { day: string; points: number }[] {
  const out: { day: string; points: number }[] = [];
  const end = Date.parse(`${TEST_TODAY}T00:00:00Z`);
  for (let k = 364; k >= 0; k--) {
    const day = new Date(end - k * 86_400_000).toISOString().slice(0, 10);
    const r = Math.abs(Math.sin(k * 12.9898 + 4.1414) * 43758.5453) % 1;
    let points = r < 0.3 ? 0 : r < 0.45 ? 1 : r < 0.65 ? 3 : r < 0.85 ? 6 : 11;
    if (k <= 2) points = [4, 6, 4][2 - k];
    if (k === 3) points = 0;
    if (k > 330) points = 0; // the first weeks before starting
    if (points) out.push({ day, points });
  }
  return out;
}
const trackMod = (round: number, position: number, title: string, state: "open" | "half" | "locked", doneCount: number, itemCount: number, reason: string | null = null) =>
  ({ position, title, state, reason, gated: false, done: doneCount === itemCount, doneCount, itemCount, round });
export const PROFILE_PROGRESS = {
  ...PROGRESS,
  courses: [
    ...PROGRESS.courses,
    { courseId: "00000000-0000-4000-8000-000000000c02", slug: "copywriting", name: "Copywriting", kind: "skill", pickStatus: "active", tier: null, plan: "basic",
      percent: 25, done: 3, items: 12, complete: false, bonus: false, capstone: null, points: 6, skillRank: { index: 1, name: "Initiate" },
      modules: [
        trackMod(1, 1, "Hooks", "open", 2, 2), trackMod(1, 2, "Offers", "open", 1, 2), trackMod(1, 3, "Proof", "open", 0, 2),
        trackMod(1, 4, "Calls to act", "open", 0, 2), trackMod(1, 5, "Testing", "locked", 0, 2, "Finish Proof first."),
        trackMod(2, 1, "Long copy", "locked", 0, 2, "Round 2 is part of Basic and Pro."),
      ],
      track: { rounds: [
        { round: 1, state: "open", reason: null, complete: false, doneCount: 3, itemCount: 10 },
        { round: 2, state: "locked", reason: "Round 2 is part of Basic and Pro.", complete: false, doneCount: 0, itemCount: 2 },
      ] } },
  ],
  pointsByDay: yearOfPoints(),
};
