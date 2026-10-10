import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { refused, type Result } from "@/lib/courses/common";
import { RANKS } from "@/lib/progress/config";
import { totalsOf } from "@/lib/progress/progress";
import { rankOf, rankName } from "@/lib/progress/rules";
import { LEADERBOARD_NOTE, TEEN_BOARD_NOTE, checkNickname, practiceRivals } from "./leaderboard-rules";

/**
 * C2: the leaderboard. A server-side view (the database function leaderboard_adults) of nickname, rank and streak only;
 * no browser ever queries other learners' rows.
 *   Adults (18+): on by default once they pick a nickname (never their real name or email), with an opt-out in Account.
 *   The Owner can remove a nickname (audited, with a reason); the learner then picks another.
 *   Teens (14 to 17): never see real learners and are never shown to others. Their board is practice rivals (simulated,
 *   labelled on every row) and their own row.
 * No chat, stickers, profile links or messages between users.
 */

type Me = { nickname: string | null; nickname_removed_at: string | null; leaderboard_opt_out: boolean; display_name: string | null };
async function me(actor: Account): Promise<Me> {
  return ((await getDb().from("profiles").select("nickname, nickname_removed_at, leaderboard_opt_out, display_name").eq("account_id", actor.id).maybeSingle()).data as Me | null)
    ?? { nickname: null, nickname_removed_at: null, leaderboard_opt_out: false, display_name: null };
}

export async function leaderboard(actor: Account, now = new Date()) {
  const totals = await totalsOf(actor.id);
  const rank = rankOf(totals.points);
  const p = await me(actor);
  const mine = { nickname: actor.isMinor ? "You" : p.nickname && !p.nickname_removed_at ? p.nickname : "You", rank: rank.name, rankIndex: rank.index, points: totals.points, streak: totals.current, you: true };
  if (actor.isMinor) {
    const rows = [...practiceRivals(actor.id, totals.points, now), { ...mine, simulated: false as const }].sort((a, b) => b.points - a.points);
    return { kind: "practice" as const, rows, note: TEEN_BOARD_NOTE, settings: null };
  }
  const { data, error } = await getDb().rpc("leaderboard_adults", { p_thresholds: RANKS.map((r) => r.points), p_limit: 50 });
  if (error) throw new Error(`leaderboard failed: ${error.message}`);
  const rows = ((data ?? []) as { nickname: string; points: number | string; rank_index: number; current_streak: number }[]).map((r) => ({
    nickname: r.nickname, rank: rankName(r.rank_index), rankIndex: r.rank_index, points: Number(r.points), streak: r.current_streak, you: !!p.nickname && r.nickname === p.nickname,
  }));
  const shown = !!p.nickname && !p.nickname_removed_at && !p.leaderboard_opt_out;
  return {
    kind: "public" as const, rows, you: mine, note: LEADERBOARD_NOTE,
    settings: { nickname: p.nickname_removed_at ? null : p.nickname, removed: !!p.nickname_removed_at, optOut: p.leaderboard_opt_out, shown },
  };
}

/** Body: { nickname }. Adults only. Not audited beyond the event (a nickname isn't a real name). */
export async function setNickname(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "leaderboard.nickname";
  if (actor.isMinor) return refused(403, "Teens aren't on the public leaderboard, so there's no nickname to set.", A);
  const c = checkNickname(body.nickname, { displayName: actor.displayName, email: actor.email });
  if ("problem" in c) return refused(400, c.problem, A);
  const { error } = await getDb().from("profiles").update({ nickname: c.nickname, nickname_set_at: new Date().toISOString(), nickname_removed_at: null }).eq("account_id", actor.id);
  if (error?.code === "23505") return refused(409, "That nickname is taken. Try another.", A);
  if (error) throw new Error(`nickname failed: ${error.message}`);
  return { ok: true, body: await leaderboard(actor), event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: null, next: c.nickname, context: `Chose the leaderboard nickname "${c.nickname}".` } };
}

/** Body: { optOut }. The clear opt-out in Account. */
export async function setOptOut(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "leaderboard.opt_out";
  if (typeof body.optOut !== "boolean") return refused(400, "Choose to show or hide yourself.", A);
  const { error } = await getDb().from("profiles").update({ leaderboard_opt_out: body.optOut }).eq("account_id", actor.id);
  if (error) throw new Error(`opt-out failed: ${error.message}`);
  return {
    ok: true, body: await leaderboard(actor),
    event: { action: A, result: "Completed", target: { type: "account", id: actor.id }, previous: body.optOut ? "shown" : "hidden", next: body.optOut ? "hidden" : "shown", context: body.optOut ? "Left the leaderboard." : "Joined the leaderboard." },
  };
}

/** The Owner removes a nickname. Body: { nickname, reason (from withCap) }. */
export async function removeNickname(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "leaderboard.moderate";
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner removes a nickname.", A);
  const nick = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!nick) return refused(400, "Which nickname?", A);
  const db = getDb();
  const row = (((await db.from("profiles").select("account_id, nickname").ilike("nickname", nick)).data ?? []) as { account_id: string; nickname: string }[])[0];
  if (!row) return refused(404, "No learner has that nickname.", A);
  const { error } = await db.from("profiles").update({ nickname_removed_at: new Date().toISOString() }).eq("account_id", row.account_id);
  if (error) throw new Error(`nickname removal failed: ${error.message}`);
  return {
    ok: true, body: { removed: row.nickname },
    event: { action: A, result: "Completed", target: { type: "account", id: row.account_id, label: row.nickname }, previous: row.nickname, next: "removed", context: `The Owner removed the nickname "${row.nickname}" from the leaderboard. The learner picks a new one to appear again.` },
  };
}
