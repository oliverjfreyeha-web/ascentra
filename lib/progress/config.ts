/**
 * C2: the one config file for how learners move through courses. Everything marked STARTER is a placeholder the Owner
 * decides later (rank names 1-8, every point threshold, the gate ranks, the streak rules); change it here only.
 * Pure: no database. Tested in tests/unit/progress-rules.test.ts.
 */

/** A quiz item counts as done at this score or more (0 to 1). */
export const QUIZ_PASS = 0.8;

/** The importance label every video, task and assignment carries, and the points it gives (STARTER points). */
export const IMPORTANCE = {
  should_know: { label: "Should know", points: 1 },
  important: { label: "Important", points: 2 },
  very_important: { label: "Very important", points: 3 },
} as const;
export type Importance = keyof typeof IMPORTANCE;
export const IMPORTANCE_KEYS = Object.keys(IMPORTANCE) as Importance[];
export const isImportance = (v: unknown): v is Importance => typeof v === "string" && (IMPORTANCE_KEYS as string[]).includes(v);

/** Finishing a course's capstone (STARTER). */
export const CAPSTONE_POINTS = 40;

/**
 * The ten ranks, lowest to highest. Names 9 and 10 are the Owner's choice; 1-8 are placeholders the Owner may rename.
 * STARTER thresholds (points needed), each more than the last. The curve: a typical Large course (9 modules of about
 * 12 items at an average of 2 points, so about 216) plus its capstone (40) is about 256 points, so Ascendant (260)
 * takes at least a full Large course and its capstone; FINAL FOUNDER (220) most of one. A Compact course and capstone
 * (about 100) reaches Closer; a Standard one (about 160) Architect or Trailblazer.
 */
export const RANKS = [
  { name: "Initiate", points: 0 },
  { name: "Explorer", points: 10 },
  { name: "Builder", points: 25 },
  { name: "Operator", points: 45 },
  { name: "Strategist", points: 70 },
  { name: "Closer", points: 100 },
  { name: "Architect", points: 135 },
  { name: "Trailblazer", points: 175 },
  { name: "FINAL FOUNDER", points: 220 },
  { name: "Ascendant", points: 260 },
] as const;

/**
 * Rank gates: the last half of a course's modules (rounded up, at most 4) open only fully, only when the previous module
 * is done and the learner holds the rank below (by gate order: first gated module, second, ...). STARTER ranks (1-based).
 * Safeguard: a gate never asks for more than the points the course's earlier modules give, so finishing them always
 * meets it (no learner gets stuck).
 */
export const GATE_MAX = 4;
export const GATE_RANKS = [2, 3, 4, 5];

/** The trial: modules 1 and 2. The bonus (half of module 3, Standard and Large only) counts if earned before this day. */
export const TRIAL_MODULES = 2;
export const TRIAL_BONUS_BEFORE_DAY = 14;

/**
 * The streak (STARTER, for the Owner to confirm): a day counts when the learner finishes at least one item; the day ends
 * at midnight in the learner's own time zone; missing a full day resets the current streak to 0; the longest is kept.
 * No freezes or repairs.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

/** Optional AI summaries of the Notebook: off unless the learner turns them on; at most this many a day each. */
export const AI_SUMMARY_DAILY_LIMIT = 3;

/** Real-world mission kinds. contacts: it involves contacting someone (a teen needs a Guardian's approval each time). */
export const MISSION_TYPES = {
  public_post: { label: "Post something publicly", contacts: false },
  local_observation: { label: "Observe a business or market (no contact)", contacts: false },
  create_listing: { label: "Create a listing or a page", contacts: false },
  contact_business: { label: "Contact a business (email or form)", contacts: true },
  customer_interview: { label: "Interview a possible customer", contacts: true },
} as const;
export type MissionType = keyof typeof MISSION_TYPES;
export const isMissionType = (v: unknown): v is MissionType => typeof v === "string" && Object.prototype.hasOwnProperty.call(MISSION_TYPES, v);

/** What a teen never does on a mission, whatever the state or approval. */
export const TEEN_MISSION_LIMITS = [
  "No messaging private individuals.",
  "No meeting anyone in person.",
  "No sharing personal details (yours or anyone else's).",
  "No handling real client money or accounts.",
];

/** Notebook categories. */
export const NOTEBOOK_CATEGORIES = { videos: "Videos", assignments: "Assignments", tasks: "Tasks", quizzes: "Quizzes", key_terms: "Key terms" } as const;
export type NotebookCategory = keyof typeof NOTEBOOK_CATEGORIES;

/** US states and DC, for the private State question. */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
export const isStateCode = (v: unknown): v is string => typeof v === "string" && Object.prototype.hasOwnProperty.call(US_STATES, v);
