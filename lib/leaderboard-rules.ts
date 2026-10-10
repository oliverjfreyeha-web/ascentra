/**
 * C2: the leaderboard's pure parts. Nickname rules, and the practice rivals a teen sees instead of real people.
 * Tested in tests/unit/leaderboard.test.ts.
 *
 * Practice rivals: teens never see real learners and are never shown to anyone. Their board shows simulated rivals,
 * made up by the server from a fixed word list, with made-up ranks and streaks near the teen's own, plus the teen's row.
 * Every rival row says "Practice rival (simulated)" and is never described as a real person. They change once a week.
 */
import { RANKS } from "@/lib/progress/config";

export const RIVAL_LABEL = "Practice rival (simulated)";
export const LEADERBOARD_NOTE = "Shows nicknames, ranks and streaks only. Never a real name.";
export const TEEN_BOARD_NOTE = "Your board shows practice rivals. They're simulated, not real people, so you can compare your progress safely.";

const BLOCKED = ["admin", "owner", "ascentra", "support", "staff", "official", "moderator", "guardian", "teacher", "fuck", "shit", "bitch", "cunt", "nigg", "fag", "slut", "whore", "dick", "cock", "pussy", "nazi", "hitler", "rape", "kill", "porn", "sex"];

/** A nickname: 3 to 20 letters, numbers, - or _; never the learner's real name or email; nothing rude or official-sounding. */
export function checkNickname(raw: unknown, who: { displayName?: string | null; email?: string | null }): { nickname: string } | { problem: string } {
  const nick = typeof raw === "string" ? raw.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$/.test(nick)) return { problem: "Use 3 to 20 letters or numbers (you can use - and _). Start with a letter or number." };
  const low = nick.toLowerCase().replace(/[_-]/g, "");
  if (BLOCKED.some((w) => low.includes(w))) return { problem: "Choose a different nickname." };
  if (/\d{7,}/.test(nick)) return { problem: "Don't use phone numbers or long number strings." };
  const parts = [...(who.displayName ?? "").toLowerCase().split(/[^a-z0-9]+/), (who.email ?? "").toLowerCase().split("@")[0]].filter((p) => p.length >= 3);
  if (parts.some((p) => low.includes(p.replace(/[^a-z0-9]/g, "")))) return { problem: "Don't use your real name or email. Pick a nickname that doesn't identify you." };
  return { nickname: nick };
}

// ============ Practice rivals ============

const FIRST = ["Swift", "Quiet", "Bright", "Steady", "Clever", "Bold", "Calm", "Lucky", "Sunny", "Brisk", "Keen", "Nimble"];
const SECOND = ["Otter", "Falcon", "Maple", "Comet", "Harbor", "Pine", "Lynx", "Ember", "River", "Summit", "Kestrel", "Willow"];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function rng(seed: string) {
  let h = hash(seed);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
/** The week a board is made for (Monday's date, UTC): rivals stay the same all week. */
export function weekOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type RivalRow = { nickname: string; rank: string; rankIndex: number; points: number; streak: number; simulated: true; label: typeof RIVAL_LABEL };

/** The rivals for one teen this week: made up, near the teen's own points, each labelled. */
export function practiceRivals(viewerId: string, myPoints: number, now: Date, count = 8): RivalRow[] {
  const r = rng(`${viewerId}:${weekOf(now)}`);
  const used = new Set<string>();
  const rows: RivalRow[] = [];
  while (rows.length < count) {
    const name = `${FIRST[Math.floor(r() * FIRST.length)]}${SECOND[Math.floor(r() * SECOND.length)]}${Math.floor(r() * 90) + 10}`;
    if (used.has(name)) continue;
    used.add(name);
    const points = Math.max(0, Math.round(myPoints + (r() - 0.45) * Math.max(30, myPoints * 0.8)));
    let index = 0;
    for (let k = 0; k < RANKS.length; k++) if (points >= RANKS[k].points) index = k;
    rows.push({ nickname: name, rank: RANKS[index].name, rankIndex: index + 1, points, streak: Math.floor(r() * 15), simulated: true, label: RIVAL_LABEL });
  }
  return rows.sort((a, b) => b.points - a.points);
}
