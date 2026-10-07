"use client";

import { useCallback, useEffect, useState } from "react";
import { call, when } from "../../call";
import { meFrom } from "../../me";
import { safetyEventsFrom, type SafetyEvent } from "../../mentor-api";
import { Loading } from "../../ui/loading";

/** L4: the Owner's and Super Admins' safety review queue. */
export function SafetyQueue() {
  const [role, setRole] = useState<string | null>(null);
  const [events, setEvents] = useState<SafetyEvent[] | null>(null);
  const [status, setStatus] = useState("open");
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await call("GET", `/api/v1/safety/events?status=${status}`);
    const list = r._status === 200 ? safetyEventsFrom(r) : null;
    setEvents(list);
    if (!list) setMessage(r.reason ?? "Couldn't load the safety queue.");
  }, [status]);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the API when the filter changes
    void load();
  }, [load]);

  async function review(id: string) {
    const r = await call("POST", `/api/v1/safety/events/${id}/review`, { reason: notes[id] ?? "" });
    setMessage(r._status === 200 ? "Marked reviewed." : r.reason ?? "Nothing was changed.");
    await load();
  }

  if (role && role !== "owner" && role !== "superAdmin") return <p>Only the Owner and Super Admins review safety events.</p>;
  return (
    <>
      <p><label>Show <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="">All</option></select></label></p>
      {message && <p role="status">{message}</p>}
      {events === null ? <Loading shape="table" /> : events.length === 0 ? <p className="muted ui-empty ui-empty--inline">Nothing here.</p> : events.map((e) => (
        <div key={e.id} className="notice">
          <p>
            <strong>{e.teen ? "Teen · " : ""}{e.categoryLabel}</strong> · {e.severity}{e.priority === 0 ? " · first in queue" : ""} · {e.stage === "output" ? "in a Mentor reply" : "in a learner's message"} · {when(e.createdAt)}
          </p>
          <p className="small">{e.subject.name ?? "Learner"} ({e.subject.email ?? e.subject.id})</p>
          <p className="small muted">Done: {e.actions.join("; ")}{e.guardianPolicy ? ` · ${e.guardianPolicy}` : ""}</p>
          {e.status === "reviewed" ? <p className="small">Reviewed {when(e.reviewedAt)}: {e.reviewNote}</p> : (
            <p>
              <label>Review note (recorded) <input value={notes[e.id] ?? ""} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} size={50} /></label>{" "}
              <button type="button" disabled={(notes[e.id] ?? "").trim().length < 5} onClick={() => void review(e.id)}>Mark reviewed</button>
            </p>
          )}
        </div>
      ))}
    </>
  );
}
