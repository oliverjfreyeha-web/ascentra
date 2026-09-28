"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useReverification } from "@clerk/nextjs";
import { ADMIN_ROLES, ROLE_LABEL, type AdminRole } from "@/lib/caps";

type Admin = { accountId: string; email: string; displayName: string; role: AdminRole; courses: string[]; state: "active" | "awaiting_second_factor" };
type Invite = { id: string; email: string; role: AdminRole; courses: string[]; expiresAt: string; expired: boolean };
type ApiResult = { _status: number; reason?: string } & Record<string, unknown>;

const NEEDS_COURSES: AdminRole[] = ["courseAdmin", "reviewer"];
const parseCourses = (s: string) => s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

async function call(method: string, url: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Clerk's reverification hint stays at the top level so useReverification can see it.
  return { ...json, _status: res.status };
}

function RoleFields({ role, setRole, courses, setCourses, idPrefix }: {
  role: AdminRole; setRole: (r: AdminRole) => void; courses: string; setCourses: (c: string) => void; idPrefix: string;
}) {
  return (
    <>
      <label htmlFor={`${idPrefix}-role`}>Role </label>
      <select id={`${idPrefix}-role`} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
        {ADMIN_ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
        ))}
      </select>{" "}
      {NEEDS_COURSES.includes(role) && (
        <>
          <label htmlFor={`${idPrefix}-courses`}>Courses </label>
          <input id={`${idPrefix}-courses`} value={courses} onChange={(e) => setCourses(e.target.value)} placeholder="e.g. mkt, creator" />
        </>
      )}
    </>
  );
}

export function AdminsPanel() {
  const [data, setData] = useState<{ admins: Admin[]; invites: Invite[] } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("courseAdmin");
  const [courses, setCourses] = useState("");
  const [editing, setEditing] = useState<{ accountId: string; role: AdminRole; courses: string } | null>(null);

  // Sensitive actions: if the second factor wasn't verified in the last 10 minutes, Clerk asks for it and retries.
  const sensitive = useReverification(call);

  const load = useCallback(async () => {
    const r = await call("GET", "/api/v1/admins");
    if (r._status === 200) setData(r as unknown as { admins: Admin[]; invites: Invite[] });
    else setBlocked(r._status === 401 ? "Sign in to continue." : (r.reason ?? "This page isn't available."));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function act(label: string, method: string, url: string, body?: unknown) {
    setMessage(null);
    try {
      const r = await sensitive(method, url, body);
      if (r._status >= 400) setMessage(r.reason ?? `${label} failed.`);
      else setMessage(`${label}: done.`);
    } catch {
      setMessage(`${label} was cancelled.`);
    }
    await load();
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    void act("Invite", "POST", "/api/v1/admins/invites", {
      email, role, courses: NEEDS_COURSES.includes(role) ? parseCourses(courses) : [],
    });
    setEmail("");
    setCourses("");
  }

  if (blocked) return <p role="alert">{blocked}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      {message && <p role="status">{message}</p>}

      <section aria-labelledby="admins-h">
        <h2 id="admins-h">Admins</h2>
        {data.admins.length === 0 && <p className="muted">No admins yet.</p>}
        <ul className="services">
          {data.admins.map((a) => (
            <li key={a.accountId}>
              <div className="row">
                <span>{a.displayName} · {a.email}</span>
                <span>{ROLE_LABEL[a.role]}{a.courses.length ? ` · ${a.courses.join(", ")}` : ""}</span>
              </div>
              {a.state === "awaiting_second_factor" && <div className="muted">Waiting for them to add a second factor. The role does nothing until then.</div>}
              {editing?.accountId === a.accountId ? (
                <div>
                  <RoleFields idPrefix={`edit-${a.accountId}`} role={editing.role} courses={editing.courses}
                    setRole={(r) => setEditing({ ...editing, role: r })} setCourses={(c) => setEditing({ ...editing, courses: c })} />{" "}
                  <button type="button" onClick={() => {
                    void act("Change role", "PATCH", `/api/v1/admins/${a.accountId}`, {
                      role: editing.role, courses: NEEDS_COURSES.includes(editing.role) ? parseCourses(editing.courses) : [],
                    });
                    setEditing(null);
                  }}>Save</button>{" "}
                  <button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div>
                  <button type="button" className="link" onClick={() => setEditing({ accountId: a.accountId, role: a.role, courses: a.courses.join(", ") })}>Change role</button>{" · "}
                  <button type="button" className="link" onClick={() => void act("Remove", "DELETE", `/api/v1/admins/${a.accountId}`)}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="invites-h">
        <h2 id="invites-h">Open invites</h2>
        {data.invites.length === 0 && <p className="muted">No open invites.</p>}
        <ul className="services">
          {data.invites.map((i) => (
            <li key={i.id}>
              <div className="row">
                <span>{i.email}</span>
                <span>{ROLE_LABEL[i.role]}{i.courses.length ? ` · ${i.courses.join(", ")}` : ""}</span>
              </div>
              <div className="muted">
                {i.expired ? "Expired" : `Expires ${new Date(i.expiresAt).toLocaleString()}`} ·{" "}
                <button type="button" className="link" onClick={() => void act("Revoke invite", "DELETE", `/api/v1/admins/invites/${i.id}`)}>Revoke</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="invite-h">
        <h2 id="invite-h">Invite an admin</h2>
        <form onSubmit={invite}>
          <p>
            <label htmlFor="invite-email">Email </label>
            <input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </p>
          <p><RoleFields idPrefix="invite" role={role} setRole={setRole} courses={courses} setCourses={setCourses} /></p>
          <p className="muted">
            The invite is single-use, expires in 7 days, and works only for this email. They&apos;ll need a second factor before the role does anything.
          </p>
          <button type="submit" className="primary">Send invite</button>
        </form>
      </section>
    </>
  );
}
