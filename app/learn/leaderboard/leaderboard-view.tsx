"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { call } from "../../call";
import { leaderboardFrom, type Leaderboard } from "../../progress-api";
import { Loading } from "../../ui/loading";
import "../c2.css";

/**
 * C2: nickname, rank and streak only. Adults appear after choosing a nickname (and can leave in Account); a teen's
 * board shows practice rivals, each labelled "Practice rival (simulated)", and their own row. No chat, stickers,
 * profile links or messages.
 */
export function LeaderboardView() {
  const [b, setB] = useState<Leaderboard | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    void call("GET", "/api/v1/leaderboard").then((r) => {
      const v = r._status === 200 ? leaderboardFrom(r) : null;
      setB(v);
      setFailed(v ? null : r.reason ?? "Couldn't load the leaderboard.");
    });
  }, []);
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!b) return <Loading shape="table" />;
  return (
    <>
      <p className="c2-notice" role="note">{b.note}</p>
      {b.kind === "public" && !b.settings.shown && (
        <p className="small">
          {b.settings.optOut ? "You've chosen not to appear on the leaderboard." : b.settings.removed ? "Your nickname was removed. Pick a new one to appear again." : "You're not on the leaderboard yet: pick a nickname first."}{" "}
          <Link href="/account#leaderboard">Leaderboard settings in Account</Link>
        </p>
      )}
      <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="Leaderboard table">
        <table className="c2-board">
          <caption className="sr-only">{b.kind === "practice" ? "Practice leaderboard" : "Leaderboard"}</caption>
          <thead><tr><th scope="col">Place</th><th scope="col">Nickname</th><th scope="col">Rank</th><th scope="col">Streak</th></tr></thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={`${r.nickname}-${i}`} data-you={r.you || undefined}>
                <td>{i + 1}</td>
                <td>{r.you ? <>{r.nickname} <span className="ui-badge">You</span></> : r.nickname}{r.simulated && <small>{r.label}</small>}</td>
                <td>{r.rank}</td>
                <td>{r.streak} {r.streak === 1 ? "day" : "days"}</td>
              </tr>
            ))}
            {b.kind === "public" && !b.rows.some((r) => r.you) && (
              <tr data-you><td>—</td><td>You <span className="ui-badge">Not shown to others</span></td><td>{b.you.rank}</td><td>{b.you.streak} {b.you.streak === 1 ? "day" : "days"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {!b.rows.length && <p className="muted small">No one on the leaderboard yet.</p>}
    </>
  );
}
