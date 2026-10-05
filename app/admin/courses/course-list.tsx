"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { call } from "../../call";
import { meFrom } from "../../me";
import {
  can, coursesFrom, estimateFrom, librarySourcesFrom, researchRunsFrom, usd,
  type CourseSummary, type Estimate, type LibrarySource, type ResearchRun,
} from "../../courses-api";

/** L2: the courses this admin can see, and "New course": a Blueprint proposed from approved sources. */
export function CourseList() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ slug: "", title: "", topic: "", audience: "beginner" });
  const [picked, setPicked] = useState<string[]>([]);
  const [runIds, setRunIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [c, s, r, e] = await Promise.all([
      call("GET", "/api/v1/courses"), call("GET", "/api/v1/sources?status=approved"),
      call("GET", "/api/v1/sources/research"), call("GET", "/api/v1/courses/estimate?lessons=12"),
    ]);
    const list = c._status === 200 ? coursesFrom(c) : null;
    if (!list) setMessage(c.reason ?? "Couldn't load the courses.");
    setCourses(list ?? []);
    setSources((s._status === 200 ? librarySourcesFrom(s) : null) ?? []);
    setRuns((r._status === 200 ? researchRunsFrom(r) : null) ?? []);
    setEstimate(e._status === 200 ? estimateFrom(e) : null);
  }, []);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  function toggleRun(run: ResearchRun, on: boolean) {
    setRunIds(on ? [...runIds, run.id] : runIds.filter((x) => x !== run.id));
    const approved = run.sources.filter((s) => s.status === "approved").map((s) => s.id);
    setPicked(on ? [...new Set([...picked, ...approved])] : picked.filter((x) => !approved.includes(x)));
    if (on && !form.topic) setForm({ ...form, topic: run.topic, audience: run.audience });
  }

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("Proposing a Blueprint… this can take a minute or two.");
    const r = await call("POST", `/api/v1/courses/${encodeURIComponent(form.slug)}/blueprints`, { title: form.title, topic: form.topic, audience: form.audience, sourceIds: picked, researchRunIds: runIds });
    setBusy(false);
    if (r._status === 201) router.push(`/admin/courses/${encodeURIComponent(form.slug)}`);
    else setMessage(r.reason ?? "The Blueprint wasn't generated.");
  }

  return (
    <>
      {message && <p role="status" className="notice">{message}</p>}
      <section aria-labelledby="courses-h">
        <h2 id="courses-h">Courses</h2>
        {courses === null ? <p className="muted">Loading…</p> : courses.length === 0 ? <p className="muted">No courses yet.</p> : (
          <ul>
            {courses.map((c) => (
              <li key={c.slug}>
                <Link href={`/admin/courses/${encodeURIComponent(c.slug)}`}>{c.name}</Link>{" "}
                <span className="muted small">
                  ({c.slug}) · {c.versions.length ? c.versions.map((v) => `v${v.version} ${v.status}`).join(", ") : "no version yet"}
                  {c.blueprints.draft ? ` · ${c.blueprints.draft} Blueprint(s) to review` : ""}
                  {c.versions.length > 0 && <> · last verified {c.freshness.lastVerifiedAt ? new Date(c.freshness.lastVerifiedAt).toLocaleDateString() : "not yet"}, next refresh {c.freshness.nextRefreshAt ? new Date(c.freshness.nextRefreshAt).toLocaleDateString() : "—"}{c.freshness.due ? " (due)" : ""}</>}
                  {c.freshness.staleLessons.length > 0 && <strong> · {c.freshness.staleLessons.length} stale lesson(s)</strong>}
                  {c.freshness.status !== "idle" && ` · ${c.freshness.status.replace("_", " ")}${c.freshness.note ? `: ${c.freshness.note}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {can("build", role) && (
        <section aria-labelledby="new-h">
          <h2 id="new-h">New course: propose a Blueprint</h2>
          {estimate && (
            <p className="muted small">
              {estimate.aiOn
                ? <>Estimate before you run it: Blueprint up to {usd(estimate.course.blueprint)}; each lesson draft up to {usd(estimate.course.perLesson)}; a {estimate.course.lessons}-lesson course with its research about {usd(estimate.course.total)}. Left under the caps: {usd(estimate.left.day)} today, {usd(estimate.left.month)} this month.</>
                : <>AI is off: ANTHROPIC_API_KEY isn&apos;t set. Blueprints and lesson drafts are disabled; everything else works.</>}
            </p>
          )}
          {estimate?.aiOn && (
            <form onSubmit={generate}>
              <p>
                <label>Course id (lowercase, dashes) <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} pattern="[a-z0-9][a-z0-9-]{1,39}" required /></label>{" "}
                <label>Title <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required minLength={3} /></label>
              </p>
              <p>
                <label>Topic <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} required minLength={3} /></label>{" "}
                <label>Audience{" "}
                  <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                    <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                  </select>
                </label>
              </p>
              {runs.length > 0 && (
                <fieldset>
                  <legend>From research (adds its approved sources and its outdated notes)</legend>
                  {runs.map((r) => (
                    <label key={r.id} style={{ display: "block" }}>
                      <input type="checkbox" checked={runIds.includes(r.id)} onChange={(e) => toggleRun(r, e.target.checked)} /> {r.topic}{" "}
                      <span className="muted small">({r.sources.filter((s) => s.status === "approved").length} of {r.sources.length} sources approved)</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset>
                <legend>Approved sources to build from ({picked.length} chosen)</legend>
                {sources.length === 0 ? <p className="muted">No approved sources yet. Approve some in the Source library.</p> : sources.map((s) => (
                  <label key={s.id} style={{ display: "block" }}>
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />{" "}
                    {s.title} <span className="muted small">(last checked {s.lastCheckedAt?.slice(0, 10) ?? "unknown"})</span>
                  </label>
                ))}
              </fieldset>
              <button type="submit" disabled={busy || !picked.length}>Propose a Blueprint (up to {usd(estimate.course.blueprint)})</button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
