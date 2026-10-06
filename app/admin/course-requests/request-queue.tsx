"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { call, when } from "../../call";
import { meFrom } from "../../me";
import { requestDecidedFrom, requestsFrom, type CourseRequest } from "../../path-api";

/** L7: the Course Admins' (and the Owner's) queue of anonymous course requests. */
export function RequestQueue() {
  const [role, setRole] = useState<string | null>(null);
  const [list, setList] = useState<CourseRequest[] | null>(null);
  const [status, setStatus] = useState("open");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("GET", `/api/v1/course-requests?status=${status}`);
    const l = r._status === 200 ? requestsFrom(r) : null;
    setList(l);
    if (!l) setMessage(r.reason ?? "Couldn't load the requests.");
  }, [status]);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load from the API when the filter changes
    void load();
  }, [load]);

  async function decide(id: string, next: string) {
    const r = await call("POST", `/api/v1/course-requests/${id}/decide`, { status: next, reason: reasons[id] ?? "" });
    const d = r._status === 200 ? requestDecidedFrom(r) : null;
    setMessage(d ? `Marked ${d.status}.` : r.reason ?? "Nothing was changed.");
    await load();
  }

  if (role && role !== "owner" && role !== "courseAdmin") return <p>The course request queue is for the Owner and Course Admins.</p>;
  return (
    <>
      <p><label>Show <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="planned">Planned</option><option value="dismissed">Dismissed</option><option value="">All</option></select></label></p>
      {message && <p role="status">{message}</p>}
      {list === null ? <p className="muted">Loading…</p> : list.length === 0 ? <p className="muted">Nothing here.</p> : (
        <table>
          <caption className="sr-only">Course requests</caption>
          <thead><tr><th scope="col">Topic</th><th scope="col">Level</th><th scope="col">Asked</th><th scope="col">Status</th><th scope="col">Decide</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td>{r.topic} <span className="small muted">({r.key})</span></td>
                <td>{r.level}</td>
                <td>{r.count} time{r.count === 1 ? "" : "s"} · last {when(r.lastRequestedAt)}</td>
                <td>{r.status}{r.note ? `: ${r.note}` : ""}</td>
                <td className="small">
                  <label>Reason (recorded) <input value={reasons[r.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })} size={24} /></label>{" "}
                  {r.status !== "planned" && <button type="button" disabled={(reasons[r.id] ?? "").trim().length < 5} onClick={() => void decide(r.id, "planned")}>Planned</button>}{" "}
                  {r.status !== "dismissed" && <button type="button" disabled={(reasons[r.id] ?? "").trim().length < 5} onClick={() => void decide(r.id, "dismissed")}>Dismiss</button>}{" "}
                  {r.status !== "open" && <button type="button" disabled={(reasons[r.id] ?? "").trim().length < 5} onClick={() => void decide(r.id, "open")}>Reopen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">To build a course for a request, add it in the <Link href="/admin/catalog">Topic catalog</Link> flow (AI drafts, people review and publish).</p>
    </>
  );
}
