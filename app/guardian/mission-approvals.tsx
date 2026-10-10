"use client";

import { useEffect, useState } from "react";
import { call, when } from "../call";
import { guardianMissionsFrom, type GuardianMissions } from "../progress-api";

/**
 * C2: a teen's requests for real-world practice missions. Approving "missions in a course" covers that course once; a
 * mission that contacts someone needs an approval each time. The limits below always apply, whatever is approved.
 */
export function MissionApprovals() {
  const [m, setM] = useState<GuardianMissions | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call("GET", "/api/v1/guardian/missions").then((r) => setM(r._status === 200 ? guardianMissionsFrom(r) : null));
  }, []);
  async function decide(id: string, decision: "approve" | "decline") {
    setBusy(true);
    const r = await call("POST", `/api/v1/guardian/missions/${id}`, { decision });
    setBusy(false);
    const v = r._status === 200 ? guardianMissionsFrom(r) : null;
    if (v) setM(v);
    setMessage(v ? (decision === "approve" ? "Approved." : "Declined.") : r.reason ?? "Nothing was changed.");
  }
  if (!m) return null;
  return (
    <section className="ui-block" aria-labelledby="missions-h">
      <h2 id="missions-h">Real-world mission requests</h2>
      <p className="small muted">Some practice asks your teen to do something in the real world. Whatever you approve, these limits always apply:</p>
      <ul className="small">{m.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      {message && <p role="status">{message}</p>}
      {!m.requests.length ? <p className="muted small">No requests waiting.</p> : (
        <ul className="ui-rows">
          {m.requests.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.teen}</strong>: {r.scope === "course" ? `real-world missions in ${r.course}` : `one mission in ${r.course} that contacts someone`}
                {r.mission && <span className="small muted"> · {r.mission.kind}: {r.mission.prompt}</span>}
                <span className="small muted"> · asked {when(r.requestedAt)}</span>
              </span>
              <span className="ui-actions">
                <button type="button" disabled={busy} onClick={() => void decide(r.id, "approve")}>Approve<span className="sr-only">: {r.teen}, {r.course}</span></button>{" "}
                <button type="button" disabled={busy} onClick={() => void decide(r.id, "decline")}>Decline<span className="sr-only">: {r.teen}, {r.course}</span></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
