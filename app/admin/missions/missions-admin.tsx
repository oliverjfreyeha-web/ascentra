"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { call } from "../../call";
import { allowListFrom, type AllowList } from "../../progress-api";
import { Loading } from "../../ui/loading";

/** C2: the Owner's per-state allow-list for teen missions, and removing a leaderboard nickname. */
export function MissionsAdmin() {
  const verified = useReverification(call);
  const [list, setList] = useState<AllowList | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [reason, setReason] = useState("");
  useEffect(() => {
    void call("GET", "/api/v1/missions/allowlist").then((r) => {
      const v = r._status === 200 ? allowListFrom(r) : null;
      setList(v);
      setFailed(v ? null : r.reason ?? "Couldn't load the allow-list.");
    });
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await verified("PUT", "/api/v1/missions/allowlist", { missionType: type, state, teensAllowed: allowed, reason });
    const v = r && r._status === 200 ? allowListFrom(r) : null;
    if (v) { setList(v); setReason(""); }
    setMessage(v ? "Saved. Recorded in the audit log with your reason." : r?.reason ?? "Nothing was changed.");
  }
  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!list) return <Loading shape="table" />;
  const name = (code: string) => list.states.find((s) => s.code === code)?.name ?? code;
  return (
    <>
      <section className="ui-block" aria-labelledby="allow-h">
        <h2 id="allow-h">Teen missions by state</h2>
        <p className="small muted">{list.note}</p>
        <p className="small">Teen limits that always apply:</p>
        <ul className="small">{list.limits.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="Mission kinds by state (scrolls sideways on small screens)">
          <table>
            <caption className="sr-only">Mission kinds and the states where teens may do them</caption>
            <thead><tr><th scope="col">Kind of mission</th><th scope="col">Contacts someone</th><th scope="col">On for teens in</th></tr></thead>
            <tbody>
              {list.types.map((t) => (
                <tr key={t.key}><td>{t.label}</td><td>{t.contacts ? "Yes (Guardian approves each time)" : "No"}</td><td>{t.allowedStates.length ? t.allowedStates.map(name).join(", ") : "No states (off)"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {message && <p role="status">{message}</p>}
        <form className="ui-form" aria-label="Change the allow-list" onSubmit={save}>
          <label>Kind of mission <select value={type} onChange={(e) => setType(e.target.value)}><option value="">Choose…</option>{list.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label>State <select value={state} onChange={(e) => setState(e.target.value)}><option value="">Choose…</option>{list.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
          <fieldset>
            <legend>For teens in that state</legend>
            <label><input type="radio" name="allowed" checked={allowed} onChange={() => setAllowed(true)} /> On</label>{" "}
            <label><input type="radio" name="allowed" checked={!allowed} onChange={() => setAllowed(false)} /> Off</label>
          </fieldset>
          <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
          <p className="ui-actions"><button type="submit" disabled={!type || !state || reason.trim().length < 5}>Save</button></p>
        </form>
      </section>
      <RemoveNickname />
    </>
  );
}

function RemoveNickname() {
  const verified = useReverification(call);
  const [nickname, setNickname] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await verified("POST", "/api/v1/leaderboard/moderation", { nickname, reason });
    setMessage(r && r._status === 200 ? `Removed "${String(r.removed)}". The learner picks a new nickname to appear again.` : r?.reason ?? "Nothing was changed.");
    if (r?._status === 200) { setNickname(""); setReason(""); }
  }
  return (
    <form className="ui-block ui-form" aria-labelledby="nick-h" onSubmit={submit}>
      <h2 id="nick-h">Remove a leaderboard nickname</h2>
      <p className="small muted">Nicknames are filtered when chosen. Remove one that slipped through; the learner is asked to pick another.</p>
      {message && <p role="status">{message}</p>}
      <label>Nickname <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} /></label>
      <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
      <p className="ui-actions"><button type="submit" disabled={nickname.trim().length < 3 || reason.trim().length < 5}>Remove nickname</button></p>
    </form>
  );
}
