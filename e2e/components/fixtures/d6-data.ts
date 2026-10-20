/**
 * Design rebuild D6: TEST DATA for the component screenshots of the admin, account, guardian, welcome, lesson, track, path
 * and Pro pages. Deterministic and fake (example.org / example.com people only), shaped exactly like the answers the real
 * routes send (read from app/api/v1/** and lib/**). No real learner, no income claims; "Simulated" and "Practice
 * (simulated)" appear only where the real API puts them. D6_API[route] is the `api` map for openShell
 * (e2e/components/fixtures/shell-harness.ts), keyed by exact pathname.
 */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const D6_LESSON_ID = "00000000-0000-4000-8000-000000000060";
export const D6_TRACK_SLUG = "copywriting";

/** The harness's signed-in person (GET /api/v1/me there). */
const ME = ID(9);
const T = (day: number, time = "15:00:00") => `2026-10-${String(day).padStart(2, "0")}T${time}.000Z`;

// ============ Admin: /api/v1/admins (lib/admins.ts listAdmins; the Owner holds no admin role, so isn't listed) ============
const ADMINS = {
  admins: [
    { accountId: ID(11), email: "sam.rivera@example.org", displayName: "Sam Rivera", role: "superAdmin", courses: [], state: "active" },
    { accountId: ID(12), email: "lee.chen@example.org", displayName: "Lee Chen", role: "courseAdmin", courses: ["copywriting", "cold-outreach"], state: "active" },
    { accountId: ID(13), email: "noor.haddad@example.org", displayName: "Noor Haddad", role: "reviewer", courses: ["copywriting"], state: "awaiting_second_factor" },
  ],
  invites: [{ id: ID(21), email: "pat.morgan@example.org", role: "support", courses: [], expiresAt: T(24), expired: false }],
};

// ============ Audit: /api/v1/audit (lib/audit.ts toEvent) ============
const ev = (seq: number, at: string, actor: string, actorRole: string | null, action: string, context: string, target: string | null,
  previous: string | null, next: string | null, reason: string | null, sensitive: boolean, status = "Recorded") =>
  ({ seq, at, actor, actorRole, action, context, target, previous, next, reason, result: "Completed", status, sensitive, requestId: null, deviceId: null,
    hash: `${String(seq).padStart(4, "0")}${"ab".repeat(30)}` });
const AUDIT = {
  events: [
    ev(1046, T(19, "14:05:00"), "Test person (Owner)", "owner", "audit.verify", "The audit chain is intact: 1045 event(s), head #1045.", null, null, null, null, false),
    ev(1045, T(19, "13:40:00"), "Test person (Owner)", "owner", "admins.invite", "Invited pat.morgan@example.org as Support Admin; the invite expires 2026-10-24T15:00:00.000Z.",
      "pat.morgan@example.org", null, "Support Admin", "Covering support on weekends", true),
    ev(1044, T(19, "11:12:00"), "Lee Chen (Course Admin)", "courseAdmin", "courses.refresh.run", "Checked the sources of Copywriting for changes.", "Copywriting", null, null, null, false),
    ev(1043, T(18, "18:30:00"), "Stripe webhook", null, "billing.subscription.sync", "Subscription started in Stripe: 14-day free trial (converts to Basic), trial ends 2026-10-27.",
      "subscription:sub_test_d6", null, "trialing", null, false),
    ev(1042, T(18, "09:02:00"), "Noor Haddad (Learning Reviewer)", "reviewer", "admins.activate", "Added a second factor; the Learning Reviewer role is now active.", "noor.haddad@example.org",
      "awaiting second factor", "active", null, true),
    ev(1041, T(17, "16:45:00"), "Avery Example (Learner)", "learner", "devices.register", "Trusted a new device on its first verified sign-in: Safari on iPhone.", "Safari on iPhone",
      null, "Trusted", null, false),
  ],
  next: null,
};

// ============ Safety: /api/v1/safety/events (lib/mentor/safety-queue.ts; never what was written) ============
const GUARDIAN_POLICY = "PLACEHOLDER (counsel item): the Guardian is not alerted until a policy is set.";
const SAFETY = {
  events: [
    { id: ID(31), category: "self_harm", categoryLabel: "Self-harm", severity: "urgent", priority: 0, stage: "input", teen: true,
      actions: ["Safety response shown", "Conversation paused", "Guardian alert: not sent (policy placeholder)"], guardianPolicy: GUARDIAN_POLICY,
      status: "open", reviewNote: null, reviewedAt: null, createdAt: T(19, "12:20:00"), subject: { id: ID(41), name: "Jordan Example", email: "jordan.teen@example.org" } },
    { id: ID(32), category: "threat", categoryLabel: "Threat of harm", severity: "urgent", priority: 1, stage: "input", teen: false, actions: ["Safety response shown"], guardianPolicy: null,
      status: "open", reviewNote: null, reviewedAt: null, createdAt: T(18, "20:05:00"), subject: { id: ID(42), name: "Casey Sample", email: "casey.sample@example.com" } },
    { id: ID(33), category: "personal_data", categoryLabel: "Personal data", severity: "standard", priority: 2, stage: "output", teen: false, actions: ["Safety response shown"], guardianPolicy: null,
      status: "open", reviewNote: null, reviewedAt: null, createdAt: T(17, "10:40:00"), subject: { id: ID(43), name: "Morgan Demo", email: "morgan.demo@example.com" } },
  ],
};

// ============ Owner review: /api/v1/review/checklist and /api/v1/boosters (lib/courses/boosters.ts; seed rows 0020) ============
const CHECKLIST = { courses: [{
  slug: "copywriting", name: "Copywriting", version: 2, status: "draft", unpublished: false, approved: 6, modules: 15, track: true,
  rounds: [{ round: 1, sections: 5, status: "Published" }, { round: 2, sections: 5, status: "Review" }, { round: 3, sections: 5, status: "Draft" }],
  waiting: [{ id: ID(107), position: 7, title: "Headlines that say one thing", round: 2, label: "Round 2 · Section 2" }],
  notReady: [{ id: ID(111), position: 11, title: "Plain words, again", round: 3, label: "Round 3 · Section 1", blockers: ["No reviewed quiz item yet.", "1 video slot has no approved video."] }],
  sentBack: [{ id: ID(108), position: 8, title: "Offers people understand", round: 2, label: "Round 2 · Section 3", note: "Add a second example from the sources.", at: T(16, "11:00:00") }],
  emptySlots: [{ id: ID(311), title: "Reading a sentence aloud", status: "waiting", module: 11 }],
  income: { ok: true, findings: [] },
}] };
const booster = (n: number, key: string, name: string, description: string, itemTypes: string[], inUse: number, active = true) =>
  ({ id: ID(700 + n), key, name, description, itemTypes, active, inUse });
const TYPE_LABEL: [string, string][] = [["multiple_choice", "Multiple choice"], ["true_false", "True or false"], ["matching", "Matching"], ["ordering", "Ordering"],
  ["flashcard", "Flashcard self-check"], ["short_answer", "Short answer"], ["build_it", "Build-it exercise"], ["branching_scenario", "Branching scenario"],
  ["spot_the_mistake", "Spot the mistake"], ["case_teardown", "Case teardown"], ["teach_back", "Teach it back"], ["mini_project", "Mini-project"]];
const BOOSTERS = {
  boosters: [
    booster(1, "real-world-teardown", "Real-world teardown", "Take apart a real example from the sources and say what works and what doesn't.", ["case_teardown"], 4),
    booster(2, "common-mistakes-hunt", "Common-mistakes hunt", "Find the mistake in a short passage, the kind beginners make.", ["spot_the_mistake"], 9),
    booster(3, "checklist-or-template", "Checklist or template", "A checklist or template the learner fills in for their own work.", ["build_it", "mini_project"], 3),
    booster(6, "teach-it-back", "Teach-it-back", "Explain the idea in your own words, as if to a beginner.", ["teach_back"], 7),
    booster(7, "weekly-reflection", "Weekly reflection", "A short written reflection on what was tried this week and what comes next.", ["short_answer"], 0, false),
  ],
  types: TYPE_LABEL.map(([type, label]) => ({ type, label })),
};

// ============ Account: billing (app/api/v1/billing/route.ts, lib/billing-terms.ts, lib/mentor-allowance-terms.ts) ============
const PLANS = [{ key: "basic", name: "Basic", cents: 2000 }, { key: "pro", name: "Pro", cents: 5000 }];
const RENEWAL_TERMS = {
  title: "Automatic Renewal Terms", version: "v0.1",
  body: "ASCENTRA plans renew automatically every month until you cancel. Basic is $20.00 per month and Pro is " +
    "$50.00 per month, in US dollars. Your first subscription to Basic starts with a free 14-day trial: unless " +
    "you cancel before the trial ends, it converts to Basic and you are charged $20.00 when the trial ends, then " +
    "every month on that date. Pro is charged when you subscribe, then every month on that date. You can cancel " +
    "any time from the Billing section of your Account page. You keep access through the end of the trial or of " +
    "the period you paid for, and you are not charged again. ASCENTRA is available in the United States only.",
};
const ADDON_TERMS = {
  title: "Mentor Allowance Terms", version: "v0.1",
  body: "The Mentor allowance is an optional add-on to an ASCENTRA plan that pays for the Mentor's AI use. It is prepaid: " +
    "$5.00, $10.00 or $20.00 per month in US dollars (Basic: $5.00 or $10.00; Pro: $10.00 or $20.00), charged with your " +
    "plan on the same date. It renews automatically every month with your plan until you remove it or cancel the plan. " +
    "Raising it takes effect right away, and you're charged the prorated difference for the rest of the current period, " +
    "shown before you confirm. Lowering or removing it takes effect at your next renewal; there is no refund for the " +
    "current period. Part of each month's amount covers running costs, so the usable allowance shown on your meter is " +
    "less than the amount charged. It resets at each renewal, and unused allowance doesn't carry over. When it runs out, " +
    "the Mentor pauses until it resets or you raise it; you're never charged more than the amount you chose. During a " +
    "free trial, the add-on is first charged when the trial converts. A teen's allowance is chosen and paid for by their Guardian.",
};
const NO_ALLOWANCE = (resetsAt: string | null) =>
  ({ status: "none", addonCents: 0, nextAddonCents: 0, usableUsd: 0, usedUsd: 0, resetsAt, trial: false, line: "Mentor allowance: none" });
const mentorAddon = (canChange: boolean, resetsAt: string | null) => ({
  available: true, canChange, choices: { basic: [0, 500, 1000], pro: [0, 1000, 2000] }, reservePercent: 30, trialAllowanceCents: 100,
  allowance: NO_ALLOWANCE(resetsAt), terms: ADDON_TERMS,
});
const TRIAL_ENDS = T(27, "18:30:00");
/** A learner on the 14-day free trial, which converts to Basic ($20.00) when it ends. */
const BILLING_TRIAL = {
  configured: true, canSubscribe: true, canManage: true, tier: "trial", source: "subscription",
  subscription: { plan: "trial", status: "trialing", trialEndsAt: TRIAL_ENDS, nextChargeAt: TRIAL_ENDS, nextChargeCents: 2000, accessUntil: null },
  trialEligible: false, trialDays: 14, trialWouldEndAt: "2026-11-02T15:00:00.000Z", plans: PLANS, terms: RENEWAL_TERMS,
  mentorAddon: mentorAddon(true, TRIAL_ENDS),
};
/** A Guardian's own billing read: no plan of their own (they pay for their teens'). */
const BILLING_GUARDIAN = {
  configured: true, canSubscribe: false, canManage: false, tier: "none", source: "none", subscription: null,
  trialEligible: true, trialDays: 14, trialWouldEndAt: "2026-11-02T15:00:00.000Z", plans: PLANS, terms: RENEWAL_TERMS,
  mentorAddon: mentorAddon(false, null),
};

// ============ Account: privacy, devices, progress settings ============
const PRIVACY = {
  consents: [{ id: ID(51), title: RENEWAL_TERMS.title, version: RENEWAL_TERMS.version, status: "given", at: T(13, "18:30:00"),
    method: "Separate recurring-billing checkbox before checkout", for: "You", by: "You", current: true, withdraw: "here" }],
  requests: [], subjects: [{ id: ME, name: "You" }], teenHandledByGuardian: false, canRequestDeletion: true, dueDays: { export: 45, deletion: 45 },
  mentorThreads: 2, interview: true,
};
const NO_ENFORCEMENT = { step: null, label: null, text: null, reason: null, since: null, automatic: false, limitUntil: null, limited: false, suspended: false, needsVerify: false, noticeUnread: false };
const DEVICES = {
  deviceLimit: 3,
  devices: [
    { id: ID(61), name: "Chrome on Mac", kind: "laptop", region: "OR, US", trustedAt: T(13, "18:20:00"), lastSeenAt: T(19, "14:00:00"), current: true, active: true },
    { id: ID(62), name: "Safari on iPhone", kind: "phone", region: "OR, US", trustedAt: T(17, "16:45:00"), lastSeenAt: T(18, "21:10:00"), current: false, active: false },
  ],
  sessions: [
    { id: ID(71), device: "Chrome on Mac", deviceId: ID(61), state: "active", startedAt: T(19, "13:30:00"), lastHeartbeatAt: T(19, "14:00:00"), endedAt: null, endReason: null, region: "OR, US" },
    { id: ID(72), device: "Safari on iPhone", deviceId: ID(62), state: "ended", startedAt: T(18, "20:40:00"), lastHeartbeatAt: T(18, "21:10:00"), endedAt: T(18, "21:10:00"), endReason: "timed_out", region: "OR, US" },
  ],
  enforcement: NO_ENFORCEMENT, history: [], appeals: [],
};
const LEADERBOARD = {
  kind: "public",
  rows: [
    { nickname: "quietcomet", rank: "Builder", rankIndex: 3, points: 31, streak: 9, you: false },
    { nickname: "plainwords", rank: "Explorer", rankIndex: 2, points: 14, streak: 3, you: true },
    { nickname: "tidyfox", rank: "Explorer", rankIndex: 2, points: 11, streak: 1, you: false },
  ],
  you: { nickname: "plainwords", rank: "Explorer", rankIndex: 2, points: 14, streak: 3, you: true },
  note: "Shows nicknames, ranks and streaks only. Never a real name.",
  settings: { nickname: "plainwords", removed: false, optOut: false, shown: true },
};

// ============ Guardian: /api/v1/guardian (lib/guardians.ts guardianOverview) and /api/v1/guardian/missions ============
const TEEN_DOCS = [
  { key: "teen_terms", title: "Teen Terms of Use", version: "v0.2",
    body: "You need to be at least 14, and a parent or guardian sets up your plan with you. Your account is yours. " +
      "Don't share your sign-in, and don't use anyone else's. Mentor helps you learn. It won't do your graded work, " +
      "and it will tell you when it's not sure. There's no public profile and no chat with other learners. If " +
      "something worries us, we might tell your Guardian what happened and why, but not share your private " +
      "conversations. Your Guardian agrees to these terms for your account before it starts." },
  { key: "minor_privacy_notice", title: "Minor Privacy Notice", version: "v0.2",
    body: "What we keep: your name, that you're a teen, your learning progress, your notes, your Mentor chats, and " +
      "which devices you use. Your notes and Mentor chats are private, even from your Guardian. Your Guardian sees " +
      "your progress, finished work, schedule, billing, and devices. We never sell or share your information, show " +
      "you ads based on what you do, make you findable publicly, track your precise location, or identify you by " +
      "your face or voice. You can ask to see or fix your data. Your Guardian handles export and deletion." },
];
const TEEN_RENEWS = "2026-11-03T15:00:00.000Z";
const GUARDIAN = {
  identity: { status: "verified", verifiedAt: T(5, "17:20:00") },
  teens: [
    { id: ID(41), name: "Jordan", status: "active", link: "verified", authorizedAt: T(6, "16:00:00"), withdrawnAt: null,
      consents: { teen_terms: true, minor_privacy_notice: true, renewal: true }, defaults: { voiceRecordings: "off", uploads: "private" },
      subscription: { plan: "basic", status: "active", renewsAt: TEEN_RENEWS, paidThrough: TEEN_RENEWS },
      mentorAllowance: { ...NO_ALLOWANCE(TEEN_RENEWS), choices: [0, 500, 1000] } },
    { id: ID(44), name: "Riley", status: "pending", link: "pending", authorizedAt: null, withdrawnAt: null,
      consents: { teen_terms: false, minor_privacy_notice: false, renewal: false }, defaults: { voiceRecordings: "off", uploads: "private" },
      subscription: null, mentorAllowance: null },
  ],
  documents: TEEN_DOCS,
};
const TEEN_LIMITS = ["No messaging private individuals.", "No meeting anyone in person.", "No sharing personal details (yours or anyone else's).", "No handling real client money or accounts."];
const GUARDIAN_MISSIONS = {
  requests: [{ id: ID(81), teen: "Jordan", course: "Copywriting", scope: "course", requestedAt: T(18, "17:15:00"), mission: null }],
  limits: TEEN_LIMITS,
};

// ============ Lesson: /api/v1/learn/lessons/{id} and the Mentor panel's /api/v1/mentor/threads ============
const LESSON = {
  lesson: { id: D6_LESSON_ID, title: "One idea per sentence", course: { slug: "copywriting", name: "Copywriting" }, review: null,
    version: { id: ID(161), number: 2, publishedAt: T(1, "10:00:00"), lastVerifiedOn: "2026-10-01",
      body: {
        summary: "Short sentences that carry one idea each are easier to read and harder to misread.",
        sections: [
          { heading: "Why one idea", paragraphs: [{ text: "Readers skim. A sentence with two ideas makes them choose which one to keep, and they often keep the wrong one.", refs: [1] }] },
          { heading: "How to split a sentence", paragraphs: [
            { text: "Find the words \"and\", \"but\" and \"which\". Each is a place where a sentence can often be split in two.", refs: [1] },
            { text: "Read the result aloud. If you run out of breath, split again.", refs: [2] }] },
        ],
        takeaways: [{ text: "One sentence, one idea.", refs: [1] }, { text: "Read it aloud before you send it.", refs: [2] }],
      },
      citations: [
        { ref: 1, sourceId: ID(901), title: "Plain language guidelines", url: "https://example.org/plain-language", license: "web_summarize_only", lastChecked: "2026-09-28" },
        { ref: 2, sourceId: ID(902), title: "Reading aloud as an editing step", url: "https://example.org/read-aloud", license: "web_summarize_only", lastChecked: "2026-09-28" },
      ],
      uncited: 0 } },
  progress: { status: "in_progress", completedAt: null }, update: null,
  activities: [
    { id: ID(162), type: "multiple_choice", typeLabel: "Multiple choice", graded: true, label: "Graded", level: "beginner", goal: "Spot a sentence with two ideas",
      prompt: "Which sentence carries one idea?", content: { options: ["Our tool is fast and it is also cheap.", "Our tool is fast.", "Fast, cheap, and simple, our tool is all three."] },
      result: null, why: ["suits your goal: apply it in my work or projects"] },
    { id: ID(163), type: "spot_the_mistake", typeLabel: "Spot the mistake", graded: false, label: "Practice (simulated)", level: "beginner", goal: "Split a long sentence",
      prompt: "A made-up product note. Which sentence should be split?", content: { passage: "The kettle boils in two minutes. It has a light that turns off when the water is ready and the handle stays cool." },
      result: { attempts: 1 }, why: ["It matches your interest \"freelance\"."] },
  ],
  selection: { mode: "personal", personalized: true, canPersonalize: true, note: null }, score: { graded: 0, correct: 0 },
  videos: [{ id: ID(164), title: "Reading a sentence aloud", state: "ready", transcript: "Read each sentence aloud. Where you pause, the reader pauses too." }],
  progress2: {
    module: { position: 1, title: "Plain words", state: "open", reason: null, doneCount: 1, itemCount: 4 },
    items: [
      { kind: "video", id: ID(164), importance: "important", importanceLabel: "Important", done: true, open: true, missionType: null, mission: null },
      { kind: "activity", id: ID(162), importance: "very_important", importanceLabel: "Very important", done: false, open: true, missionType: null, mission: null },
      { kind: "activity", id: ID(163), importance: "should_know", importanceLabel: "Should know", done: false, open: true, missionType: null, mission: null },
    ],
    notices: [], rank: { name: "Explorer", index: 2 }, teen: false, missionLimits: [],
  },
};
const MENTOR_THREADS = {
  threads: [],
  mentor: { aiOn: false, dailyCap: 40, allowance: { status: "none", usedUsd: 0, usableUsd: 0, resetsAt: TRIAL_ENDS, trial: false, line: "Mentor allowance: none", canChange: true } },
};

// ============ Track: /api/v1/learn/tracks/copywriting (lib/progress/track-view.ts) ============
// Whole points per Round (lib/progress/tracks.ts trackPoints): Should know 1/2/2, Important 2/3/4, Very important 3/5/6.
const PTS: Record<string, number[]> = { "Should know": [1, 2, 2], Important: [2, 3, 4], "Very important": [3, 5, 6] };
const SECTION_TITLES = ["Plain words", "Headlines that say one thing", "Offers people understand", "Proof without promises", "Editing in two passes"];
const TASKS: [string, string, string][] = [["quiz", "Very important", "Pick the clearer line"], ["sandbox", "Important", "Rewrite a made-up product note"],
  ["sequence", "Should know", "Put the edits in order"], ["assignment", "Important", "Write three versions of one line"]];
const trackSection = (round: number, k: number, state: "open" | "half" | "locked", reason: string | null, done = 0) => ({
  id: ID(round * 100 + k), number: k, title: SECTION_TITLES[k - 1], state, reason, doneCount: done, itemCount: 4, done: done === 4,
  steps: [{
    lessonId: round === 1 && k === 1 ? D6_LESSON_ID : ID(round * 1000 + k), title: `${SECTION_TITLES[k - 1]}${round > 1 ? `, Round ${round}` : ""}`,
    summary: state === "locked" ? null : "One short lesson, then its tasks.",
    items: TASKS.map(([part, label, title], i) => ({
      kind: "activity", id: ID(round * 10000 + k * 10 + i + 1), title, part, importanceLabel: label, points: PTS[label][round - 1],
      done: done > i, open: state === "open" || (state === "half" && i < 2),
    })),
  }],
});
const TRACK = {
  slug: D6_TRACK_SLUG, name: "Copywriting", plan: "basic", version: 2, rank: { name: "Builder", points: 31 },
  rounds: [
    { round: 1, label: "Round 1: the basics", goal: "Write clear, short lines about a made-up product.", state: "open", reason: null, complete: true, doneCount: 20, itemCount: 20,
      sections: [1, 2, 3, 4, 5].map((k) => trackSection(1, k, "open", null, 4)) },
    { round: 2, label: "Round 2: going deeper", goal: "The same five sections, with longer drafts.", state: "open", reason: null, complete: false, doneCount: 6, itemCount: 20,
      sections: [trackSection(2, 1, "open", null, 4), trackSection(2, 2, "half", "The rest opens when you finish section 1.", 2),
        trackSection(2, 3, "locked", "Opens when you finish half of section 2."), trackSection(2, 4, "locked", "Opens when you finish half of section 3."),
        trackSection(2, 5, "locked", "Opens when you finish half of section 4.")] },
    { round: 3, label: "Round 3", goal: null, state: "locked", reason: "Round 3 is part of Pro.", complete: false, doneCount: 0, itemCount: 20,
      sections: [1, 2, 3, 4, 5].map((k) => trackSection(3, k, "locked", "Round 3 is part of Pro.")) },
  ],
  note: "Each Round goes deeper into the same 5 sections. Finish every item of a Round to open the next.",
};

// ============ Path: /api/v1/learn/interview and /api/v1/learn/path (lib/path/path.ts) ============
const INTERVIEW = {
  options: {
    goals: [{ key: "basics", label: "Understand the basics" }, { key: "apply", label: "Apply it in my work or projects" }, { key: "deeper", label: "Go deeper in something I know" }],
    levels: [{ key: "beginner", label: "New to it" }, { key: "intermediate", label: "I know the basics" }, { key: "advanced", label: "I'm experienced" }],
    minutes: [60, 120, 180, 300, 480],
    topics: [{ slug: "cold-outreach", name: "Cold outreach", hasCourse: true }, { slug: "copywriting", name: "Copywriting", hasCourse: true },
      { slug: "short-form-video", name: "Short-form video", hasCourse: true }, { slug: "bookkeeping-basics", name: "Bookkeeping basics", hasCourse: false }],
    interests: ["agency", "freelance", "home-services", "local-business", "online-store", "operations", "retail", "sales-calls", "social-media", "video"],
  },
  answers: { goal: "apply", level: "beginner", minutesPerWeek: 120, topics: ["copywriting"], interests: ["freelance"] },
  skipped: false, plan: "basic",
};
const PATH = {
  plan: "basic", limit: 1, interview: { goal: "Apply it in my work or projects", level: "New to it", minutesPerWeek: 120 }, interviewNeeded: false, skipped: false,
  method: "rules", note: "Matched by rules from your answers. AI ordering is off (AI isn't set up).", aiNotice: null, activityMode: "personal", builtAt: T(13, "18:40:00"),
  courses: [{ slug: "copywriting", name: "Copywriting", outcome: "Write clear, short copy for a product page or an email.", position: 1,
    why: "You chose the topic \"Copywriting\". It's written for beginner learners, like you.", minutes: 540, weeks: 5, lastVerifiedOn: "2026-10-01", lessons: 15, firstLessonId: D6_LESSON_ID }],
  canAdd: false, addable: [{ slug: "cold-outreach", name: "Cold outreach" }, { slug: "short-form-video", name: "Short-form video" }],
};

export const D6_API: Record<string, Record<string, unknown>> = {
  admin: { "/api/v1/admins": ADMINS },
  audit: { "/api/v1/audit": AUDIT },
  safety: { "/api/v1/safety/events": SAFETY },
  review: { "/api/v1/review/checklist": CHECKLIST, "/api/v1/boosters": BOOSTERS },
  // The import page reads only /api/v1/me on load (open it with role "owner").
  import: {},
  account: {
    "/api/v1/billing": BILLING_TRIAL, "/api/v1/privacy": PRIVACY, "/api/v1/devices": DEVICES,
    "/api/v1/leaderboard": LEADERBOARD, "/api/v1/account/state": { state: "OR" },
  },
  guardian: { "/api/v1/guardian": GUARDIAN, "/api/v1/billing": BILLING_GUARDIAN, "/api/v1/guardian/missions": GUARDIAN_MISSIONS },
  welcome: { "/api/registration": { state: "dob" } },
  lesson: { [`/api/v1/learn/lessons/${D6_LESSON_ID}`]: LESSON, "/api/v1/mentor/threads": MENTOR_THREADS },
  track: { [`/api/v1/learn/tracks/${D6_TRACK_SLUG}`]: TRACK },
  path: { "/api/v1/learn/interview": INTERVIEW, "/api/v1/learn/path": PATH },
  // The real route answers a Basic or trial account 403 with this body; the harness always sends 200.
  pro: { "/api/v1/pro": { error: "forbidden", reason: "This needs the Pro plan. You can change plans from the Billing section of your Account page." } },
};
