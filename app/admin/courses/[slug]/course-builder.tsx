"use client";

import { useCallback, useEffect, useState } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, when, type ApiResult } from "../../../call";
import { meFrom } from "../../../me";
import { LessonView } from "../../../lesson-body";
import { can, courseDetailFrom, estimateFrom, usd, type CourseDetail, type Estimate, type LessonVersion, type OutdatedNote, type Plan } from "../../../courses-api";

type Bp = CourseDetail["blueprints"][number];
type Lesson = CourseDetail["modules"][number]["lessons"][number];

/** L2: one course. The Blueprint (review, edit, approve), then each lesson: draft with AI, submit, verify, publish. */
export function CourseBuilder({ slug }: { slug: string }) {
  const [role, setRole] = useState<string | null>(null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verified = useReverification(call);
  const base = `/api/v1/courses/${encodeURIComponent(slug)}`;

  const load = useCallback(async () => {
    const d = await call("GET", base);
    const parsed = d._status === 200 ? courseDetailFrom(d) : null;
    setDetail(parsed);
    setFailed(parsed ? null : d.reason ?? "Couldn't load this course.");
    const lessons = parsed?.modules.reduce((n, m) => n + m.lessons.length, 0) ?? 0;
    const e = await call("GET", `/api/v1/courses/estimate?lessons=${lessons}`);
    setEstimate(e._status === 200 ? estimateFrom(e) : null);
  }, [base]);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function act(run: () => Promise<ApiResult>, okText: (r: ApiResult) => string, pending?: string) {
    setBusy(true);
    setMessage(pending ?? null);
    const r = await run();
    setBusy(false);
    setMessage(r._status < 300 ? okText(r) : r.reason ?? "Nothing was changed.");
    await load();
  }

  if (failed) return <p role="status">{failed}</p>;
  if (!detail) return <p className="muted">Loading…</p>;
  const draftBp = detail.blueprints.find((b) => b.status === "draft");
  const approvedBp = detail.blueprints.find((b) => b.status === "approved");
  const aiOn = !!estimate?.aiOn;

  return (
    <>
      <h1>{detail.course.name}</h1>
      <p className="muted">
        {detail.course.slug} · {detail.current ? `course version v${detail.current.version}: ${detail.current.status}` : "no course version yet"}
        {estimate && <> · AI spend left: {usd(estimate.left.day)} today, {usd(estimate.left.month)} this month</>}
      </p>
      {estimate && !aiOn && <p className="notice">AI is off: ANTHROPIC_API_KEY isn&apos;t set. Drafting is disabled; review and publishing still work.</p>}
      {message && <p role="status" className="notice">{message}</p>}

      {draftBp && (
        <BlueprintPanel bp={draftBp} canEdit={can("build", role)} busy={busy}
          onSave={(plan) => act(() => call("PATCH", `${base}/blueprints/${draftBp.id}`, { plan }), () => "Blueprint saved.")}
          onApprove={() => act(() => call("POST", `${base}/blueprints/${draftBp.id}/approve`), (r) => `Blueprint approved: a Draft course version with ${r.lessons} lesson(s) was created. Draft each lesson below.`)} />
      )}
      {!draftBp && approvedBp && (
        <details>
          <summary>Approved Blueprint ({when(approvedBp.approvedAt)}) and its sources</summary>
          <BlueprintPanel bp={approvedBp} canEdit={false} busy={busy} onSave={() => {}} onApprove={() => {}} />
        </details>
      )}

      <section aria-labelledby="lessons-h">
        <h2 id="lessons-h">Lessons</h2>
        {!detail.modules.length && <p className="muted">No lessons yet: approve a Blueprint first.</p>}
        {detail.modules.map((m) => (
          <div key={m.id}>
            <h3>Module {m.position}: {m.title}{m.stage ? <span className="muted small"> · {m.stage}</span> : null}</h3>
            {m.lessons.map((l) => (
              <LessonPanel key={l.id} lesson={l} role={role} busy={busy} aiOn={aiOn} estimate={estimate} outdated={approvedBp?.outdated ?? []}
                onDraft={() => act(() => call("POST", `${base}/lessons/${l.id}/draft`), (r) => `Drafted v${r.version}: ${r.citations} source(s) cited${r.uncited ? `, ${r.uncited} passage(s) marked as having no source` : ""}${r.removed ? `, ${r.removed} paragraph(s) removed for copying a source too closely` : ""}.`, "Drafting… this can take a minute or two.")}
                onSubmit={(v) => act(() => call("POST", `${base}/versions/${v.id}/submit`), () => "Submitted for review.")}
                onReview={(v, decision, note) => act(() => call("POST", `${base}/versions/${v.id}/verify`, { decision, note }), () => (decision === "verify" ? "Verified. It can now be published." : "Returned to Draft."))}
                onPublish={(v, reason) => act(() => verified("POST", `${base}/versions/${v.id}/publish`, { reason }), () => "Published. Learners now see this version.")} />
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

function Outdated({ notes }: { notes: OutdatedNote[] }) {
  if (!notes.length) return <p className="muted small">No outdated practices were noted by the research.</p>;
  return (
    <ul>
      {notes.map((n, i) => (
        <li key={i}>{n.item}{n.replacedBy ? <> → {n.replacedBy}</> : null}{n.note ? `: ${n.note}` : ""} <span className="muted small">{n.sources.map((s) => s.title ?? s.url).join("; ") || "no source"}</span></li>
      ))}
    </ul>
  );
}

function BlueprintPanel({ bp, canEdit, busy, onSave, onApprove }: { bp: Bp; canEdit: boolean; busy: boolean; onSave: (p: Plan) => void; onApprove: () => void }) {
  const [plan, setPlan] = useState<Plan>(bp.plan);
  const [editing, setEditing] = useState(false);
  const title = (id: string | null) => (id ? bp.sources.find((s) => s.id === id)?.title ?? "a source" : null);
  const set = (fn: (p: Plan) => void) => { const next = structuredClone(plan); fn(next); setPlan(next); };
  const lessons = plan.modules.reduce((n, m) => n + m.lessons.length, 0);
  return (
    <section aria-labelledby={`bp-${bp.id}`}>
      <h2 id={`bp-${bp.id}`}>Blueprint: {plan.title} <span className="muted small">({bp.status})</span></h2>
      <p className="muted small">
        Proposed by {bp.generatedBy === "ai" ? `AI (${bp.model})` : "a person"} on {when(bp.createdAt)}{bp.editedAt ? `, edited ${when(bp.editedAt)}` : ""}, for a {bp.audience} audience,
        from {bp.sources.length} approved source(s). It is a proposal based on these sources and dates, not a judgment that it is the best curriculum.
      </p>
      {plan.outcome && <p><strong>Outcome:</strong> {plan.outcome}</p>}
      <h3>Sources</h3>
      <ul>
        {bp.sources.map((s) => (
          <li key={s.id}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title} <span className="muted small">· {s.status} · last checked {s.lastChecked?.slice(0, 10) ?? "unknown"}{s.pageAge ? ` · page dated ${s.pageAge}` : ""}</span></li>
        ))}
      </ul>
      <h3>Outdated, according to the research (for the Reviewer)</h3>
      <Outdated notes={bp.outdated} />
      <h3>Outline ({plan.modules.length} module(s), {lessons} lesson(s))</h3>
      {plan.modules.map((m, mi) => (
        <div key={mi}>
          <h4>{editing ? <input value={m.title} onChange={(e) => set((p) => { p.modules[mi].title = e.target.value; })} aria-label="Module title" /> : `Module ${mi + 1}: ${m.title}`}</h4>
          <ol>
            {m.lessons.map((l, li) => (
              <li key={li}>
                {editing ? <input value={l.title} onChange={(e) => set((p) => { p.modules[mi].lessons[li].title = e.target.value; })} aria-label="Lesson title" /> : <strong>{l.title}</strong>}
                {l.minutes ? <span className="muted small"> · {l.minutes} min</span> : null}
                {editing && m.lessons.length > 1 && <> <button type="button" className="link" onClick={() => set((p) => { p.modules[mi].lessons.splice(li, 1); })}>Remove lesson</button></>}
                <ul>
                  {l.keyClaims.map((c, ci) => (
                    <li key={ci}>
                      {editing ? <input value={c.claim} size={70} onChange={(e) => set((p) => { p.modules[mi].lessons[li].keyClaims[ci].claim = e.target.value; })} aria-label="Key claim" /> : c.claim}{" "}
                      <span className="muted small">{c.sourceId ? <>— {title(c.sourceId)}{c.quote ? <>: <q>{c.quote}</q></> : null}</> : "— No source (marked)"}</span>
                      {editing && <> <button type="button" className="link" onClick={() => set((p) => { p.modules[mi].lessons[li].keyClaims.splice(ci, 1); })}>Remove</button></>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {m.skills.length > 0 && <p className="muted small">Skills: {m.skills.map((s) => s.name).join(", ")}</p>}
        </div>
      ))}
      {canEdit && bp.status === "draft" && (
        <p>
          {editing
            ? <><button type="button" disabled={busy} onClick={() => { onSave(plan); setEditing(false); }}>Save changes</button> <button type="button" className="link" onClick={() => { setPlan(bp.plan); setEditing(false); }}>Cancel</button></>
            : <><button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit</button> <button type="button" className="primary" disabled={busy} onClick={onApprove}>Approve Blueprint</button></>}
        </p>
      )}
    </section>
  );
}

function LessonPanel({ lesson, role, busy, aiOn, estimate, outdated, onDraft, onSubmit, onReview, onPublish }: {
  lesson: Lesson; role: string | null; busy: boolean; aiOn: boolean; estimate: Estimate | null; outdated: OutdatedNote[];
  onDraft: () => void; onSubmit: (v: LessonVersion) => void; onReview: (v: LessonVersion, decision: "verify" | "return", note: string) => void; onPublish: (v: LessonVersion, reason: string) => void;
}) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const latest = lesson.versions.at(-1);
  const open = lesson.versions.find((v) => v.status === "draft" || v.status === "review");
  const live = lesson.versions.find((v) => v.status === "published");
  const shown = open ?? latest;
  return (
    <div className="notice">
      <p>
        <strong>{lesson.title}</strong>{lesson.minutes ? <span className="muted small"> · {lesson.minutes} min</span> : null}{" "}
        <span className="muted small">· {lesson.versions.length ? lesson.versions.map((v) => `v${v.version} ${v.status}${v.status === "review" && v.verified ? " (verified)" : ""}`).join(", ") : "not drafted"}{live ? ` · learners see v${live.version}` : ""}</span>
      </p>
      {!open && can("build", role) && aiOn && (
        <button type="button" disabled={busy} onClick={onDraft}>{lesson.versions.length ? "Draft a new version" : "Draft with AI"}{estimate ? ` (up to ${usd(estimate.course.perLesson)})` : ""}</button>
      )}
      {shown && (
        <details open={!!open}>
          <summary>v{shown.version} ({shown.status}{shown.status === "review" && shown.verified ? ", verified" : ""}) · drafted {when(shown.createdAt)} by {shown.generatedBy === "ai" ? `AI (${shown.model})` : "a person"}</summary>
          {shown.returnedNote && shown.status === "draft" && <p className="notice">Returned by the Reviewer: {shown.returnedNote}</p>}
          {shown.verificationNote && <p className="muted small">Reviewer&apos;s verification ({when(shown.verifiedAt)}): {shown.verificationNote}</p>}
          {shown.removedForCopying.length > 0 && <p className="muted small">Removed for copying a source too closely: {shown.removedForCopying.map((r) => `"${r.text}…" (${r.copiedWords} words)`).join("; ")}</p>}
          {shown.diffAgainst != null && (
            <details>
              <summary>Changes since v{shown.diffAgainst}</summary>
              <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                {shown.diff.filter((d) => d.op !== "same").map((d) => `${d.op === "add" ? "+ " : "- "}${d.text}`).join("\n") || "No changes."}
              </pre>
            </details>
          )}
          {(shown.status === "review" || shown.status === "draft") && outdated.length > 0 && (
            <details>
              <summary>Outdated practices noted by the research</summary>
              <Outdated notes={outdated} />
            </details>
          )}
          <LessonView body={shown.body} citations={shown.citations} lastVerifiedOn={shown.lastVerifiedOn} uncited={shown.uncited} />
          {shown.status === "draft" && can("build", role) && <button type="button" disabled={busy} onClick={() => onSubmit(shown)}>Submit for review</button>}
          {shown.status === "review" && !shown.verified && can("verify", role) && (
            <p>
              <label>What you checked, or what needs to change <input value={note} onChange={(e) => setNote(e.target.value)} size={50} /></label>{" "}
              <button type="button" disabled={busy || note.trim().length < 5} onClick={() => onReview(shown, "verify", note)}>Verify</button>{" "}
              <button type="button" disabled={busy || note.trim().length < 5} onClick={() => onReview(shown, "return", note)}>Return to Draft</button>
            </p>
          )}
          {shown.status === "review" && shown.verified && can("publish", role) && (
            <p>
              <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>{" "}
              <button type="button" className="primary" disabled={busy || reason.trim().length < 5} onClick={() => onPublish(shown, reason)}>Publish</button>
            </p>
          )}
        </details>
      )}
    </div>
  );
}
