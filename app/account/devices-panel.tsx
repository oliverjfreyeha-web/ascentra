"use client";

import { useCallback, useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { AppealForm } from "../device-gate";
import { call, when } from "../call";
import { Loading } from "../ui/loading";

type Device = { id: string; name: string; kind: string; region: string | null; trustedAt: string | null; lastSeenAt: string | null; current: boolean; active: boolean };
type Session = { id: string; device: string; state: string; startedAt: string; lastHeartbeatAt: string; endedAt: string | null; endReason: string | null; region: string | null };
type Appeal = { reference: string; step: string; status: string; submittedAt: string; decisionReason: string | null };
type Own = {
  deviceLimit: number; devices: Device[]; sessions: Session[];
  enforcement: { step: string | null; label: string | null; text: string | null; reason: string | null; limitUntil: string | null };
  history: { step: string; automatic: boolean; reason: string; at: string }[];
  appeals: Appeal[];
};

const STATUS: Record<string, string> = { under_review: "Under review", accepted: "Accepted", declined: "Declined" };

/** Your trusted devices (sign one out or remove it), recent sessions, and any safeguard step with its appeal. */
export function DevicesPanel() {
  const [data, setData] = useState<Own | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "remove" | "sign-out" } | null>(null);
  const { signOut } = useClerk();

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/devices");
    if (r._status === 200) setData(r as unknown as Own);
    else setMessage(r.reason ?? "Couldn't load your devices.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function act(d: Device, kind: "remove" | "sign-out") {
    const r = kind === "remove" ? await call("DELETE", `/api/v1/devices/${d.id}`) : await call("POST", `/api/v1/devices/${d.id}/sign-out`);
    setConfirm(null);
    setMessage(r._status >= 400 ? (r.reason ?? "That didn't work.") : kind === "remove" ? `${d.name} was removed and signed out.` : `${d.name} was signed out. It stays trusted.`);
    if (d.current && r._status < 400) await signOut({ redirectUrl: "/" });
    else await load();
  }

  if (!data) return message ? <p className="muted ui-state ui-state--error">{message}</p> : <Loading label="Loading your devices…" shape="list" />;
  const e = data.enforcement;
  const openAppeal = data.appeals.find((a) => a.status === "under_review");

  return (
    <>
      {message && <p role="status">{message}</p>}
      <section aria-labelledby="devices-h" id="devices">
        <h2 id="devices-h">Trusted devices <span className="muted">{data.devices.length} of {data.deviceLimit}</span></h2>
        <ul className="services">
          {data.devices.map((d) => (
            <li key={d.id}>
              <div className="row">
                <span><b>{d.name}</b>{d.current ? " · this device" : ""}</span>
                <span className="muted">{d.active ? "Session open" : "No open session"}</span>
              </div>
              <div className="muted">
                Trusted {when(d.trustedAt)} · last active {when(d.lastSeenAt)}{d.region ? ` · approximately ${d.region}` : ""}
              </div>
              {confirm?.id === d.id ? (
                <div>
                  {confirm.kind === "remove"
                    ? `Remove ${d.name}? ${d.current ? "You'll be signed out here." : "It's signed out and needs a new sign-in to be trusted again."}`
                    : `Sign out ${d.name}?`}{" "}
                  <button type="button" className="primary" onClick={() => act(d, confirm.kind)}>{confirm.kind === "remove" ? "Remove device" : "Sign it out"}</button>{" "}
                  <button type="button" className="link" onClick={() => setConfirm(null)}>Keep it</button>
                </div>
              ) : (
                <div>
                  <button type="button" className="link" onClick={() => setConfirm({ id: d.id, kind: "sign-out" })}>Sign out</button>{" · "}
                  <button type="button" className="link" onClick={() => setConfirm({ id: d.id, kind: "remove" })}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">
          Up to {data.deviceLimit} trusted devices. A new device past that asks you to replace one, after your second factor. A private
          (Incognito) window counts as a new device each time it&apos;s opened. One session at a time: opening ASCENTRA on another
          device pauses this one, and you choose which continues.
        </p>
      </section>

      <section aria-labelledby="safeguards-h" id="safeguards">
        <h2 id="safeguards-h">Account-sharing safeguards</h2>
        {e.step ? (
          <div className="notice">
            <p><b>{e.label}.</b> {e.text}{e.limitUntil ? ` Until ${when(e.limitUntil)}.` : ""}</p>
            <p className="muted">{e.reason}</p>
          </div>
        ) : (
          <p>No action on your account.</p>
        )}
        <p className="muted">
          Steps go one at a time: Notice, then Verify, then Limit, then Suspend. Only Notice and Verify happen automatically; Limit and
          Suspend need a person. Every step can be appealed. An IP address is never used on its own.
        </p>
        {e.step && !openAppeal && <AppealForm onDone={load} />}
        {data.appeals.length > 0 && (
          <table className="plain">
            <thead><tr><th>Reference</th><th>Step</th><th>Submitted</th><th>Status</th></tr></thead>
            <tbody>
              {data.appeals.map((a) => (
                <tr key={a.reference}>
                  <td>{a.reference}</td><td>{a.step}</td><td>{when(a.submittedAt)}</td>
                  <td>{STATUS[a.status] ?? a.status}{a.decisionReason ? `: ${a.decisionReason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="sessions-h">
        <h2 id="sessions-h">Recent sessions</h2>
        {data.sessions.length === 0 ? <p className="muted">None yet.</p> : (
          <table className="plain">
            <thead><tr><th>Device</th><th>Started</th><th>Last active</th><th>State</th></tr></thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.device}{s.region ? <span className="muted"> · {s.region}</span> : null}</td>
                  <td>{when(s.startedAt)}</td>
                  <td>{when(s.endedAt ?? s.lastHeartbeatAt)}</td>
                  <td>{s.state === "ended" ? `Ended (${(s.endReason ?? "").replace(/_/g, " ")})` : s.state === "paused" ? "Paused" : "Active"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
