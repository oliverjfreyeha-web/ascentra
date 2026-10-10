"use client";

import { useEffect, useState, type FormEvent } from "react";
import { call } from "../call";
import { leaderboardFrom, type Leaderboard } from "../progress-api";
import { US_STATES } from "@/lib/progress/config";

/**
 * C2: the learner's own settings for progress: the leaderboard nickname and opt-out (adults only; teens are never on
 * the public board), their US state (private; it decides which real-world missions a teen may do), and the time zone
 * their streak day ends in.
 */
export function ProgressSettings() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [state, setState] = useState<string>("");
  const [nick, setNick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call("GET", "/api/v1/leaderboard").then((r) => {
      const b = r._status === 200 ? leaderboardFrom(r) : null;
      setBoard(b);
      if (b?.kind === "public") setNick(b.settings.nickname ?? "");
    });
    void call("GET", "/api/v1/account/state").then((r) => { if (r._status === 200 && typeof r.state === "string") setState(r.state); });
  }, []);
  async function send(method: string, url: string, body: unknown, done: string) {
    setBusy(true);
    const r = await call(method, url, body);
    setBusy(false);
    const b = r._status < 300 && url.startsWith("/api/v1/leaderboard") ? leaderboardFrom(r) : null;
    if (b) setBoard(b);
    setMessage(r._status < 300 ? done : r.reason ?? "Nothing was changed.");
    return r._status < 300;
  }
  function saveNick(e: FormEvent) {
    e.preventDefault();
    void send("PUT", "/api/v1/leaderboard/nickname", { nickname: nick }, "Nickname saved. You're on the leaderboard.");
  }
  function saveTimeZone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void send("PUT", "/api/v1/learn/time-zone", { timeZone: tz }, `Time zone set to ${tz}. Your streak day ends at midnight there.`);
  }
  return (
    <section className="ui-block" id="leaderboard" aria-labelledby="progress-settings-h">
      <h2 id="progress-settings-h">Progress and leaderboard</h2>
      {message && <p role="status">{message}</p>}
      {board?.kind === "public" && (
        <>
          <form onSubmit={saveNick} className="ui-form" aria-label="Leaderboard nickname">
            <p className="small muted">The leaderboard shows a nickname, rank and streak only. Never your real name or email.{board.settings.removed ? " Your last nickname was removed; pick another to appear again." : ""}</p>
            <label>Nickname <input value={nick} onChange={(e) => setNick(e.target.value)} minLength={3} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,19}" aria-describedby="nick-hint" /></label>
            <span id="nick-hint" className="ui-hint">3 to 20 letters or numbers; you can use - and _.</span>
            <p className="ui-actions"><button type="submit" disabled={busy || nick.trim().length < 3}>Save nickname</button></p>
          </form>
          <label><input type="checkbox" checked={!board.settings.optOut} disabled={busy}
            onChange={(e) => void send("PUT", "/api/v1/leaderboard/visibility", { optOut: !e.target.checked }, e.target.checked ? "You're shown on the leaderboard." : "You're no longer shown on the leaderboard.")} /> Show me on the leaderboard</label>
        </>
      )}
      {board?.kind === "practice" && <p className="small muted">Teen accounts aren&apos;t shown on the leaderboard. Your board shows practice rivals (simulated) to compare with.</p>}
      <form className="ui-form" aria-label="Your state" onSubmit={(e) => { e.preventDefault(); void send("PUT", "/api/v1/account/state", { state }, "State saved."); }}>
        <label>Your state (private) <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Choose…</option>
          {Object.entries(US_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        <span className="ui-hint">Only you, ASCENTRA&apos;s systems and authorized staff see it. It decides which real-world missions are open to teens.</span>
        <p className="ui-actions"><button type="submit" disabled={busy || !state}>Save state</button></p>
      </form>
      <p className="ui-actions"><button type="button" disabled={busy} onClick={saveTimeZone}>Use this device&apos;s time zone for my streak</button></p>
    </section>
  );
}
