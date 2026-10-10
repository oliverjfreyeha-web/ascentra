"use client";

import { useCallback, useEffect, useState } from "react";
import { useReverification } from "@clerk/nextjs";
import { call, when, type ApiResult } from "../../../call";
import { meFrom } from "../../../me";
import { courseApi, studioFrom, type Studio } from "../../../studio-api";
import { can } from "../../../courses-api";
import { Loading } from "../../../ui/loading";
import { ModuleEditor } from "./module-editor";
import { CapstoneEditor, NoticesEditor, TierPicker, type StudioC2 } from "./course-c2";
import { SIZE_TIERS } from "@/lib/courses/structure";

/**
 * C1: the course studio, for a course built with the module recipe. The Owner's editor and review in one place: every
 * module's recipe and how far it's met, its lessons (reorder, edit the text), practice by part, video slots, and the
 * Owner's decision (approve, or send back with a note). Then publish or unpublish the whole course. A live course is
 * never edited in place: "Start a new version" makes a Draft copy to edit.
 */
export function CourseStudio({ slug }: { slug: string }) {
  const [role, setRole] = useState<string | null>(null);
  const [studio, setStudio] = useState<StudioC2 | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const verified = useReverification(call);
  const base = courseApi(slug);

  const load = useCallback(async () => {
    const r = await call("GET", `${base}/studio`);
    const parsed = r._status === 200 ? (studioFrom(r) as StudioC2 | null) : null;
    setStudio(parsed);
    setFailed(parsed ? null : r.reason ?? "Couldn't load the course studio.");
  }, [base]);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function act(run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) {
    setBusy(true);
    setMessage(null);
    const r = await run();
    setBusy(false);
    setMessage(r._status < 300 ? okText(r) : r.reason ?? "Nothing was changed.");
    await load();
    return r._status < 300;
  }

  if (failed) return <p role="status">{failed}</p>;
  if (!studio) return <Loading />;
  // The earlier flow (no recipe, no Owner review) keeps its own builder below.
  if (!studio.version?.ownerReviewRequired) return null;
  const v = studio.version;
  const owner = role === "owner";
  const editable = v.isDraft && can("build", role);
  const live = studio.live && !studio.live.unpublishedAt;

  return (
    <section aria-labelledby="studio-h" className="studio">
      <h2 id="studio-h">Course studio</h2>
      <p className="muted">
        Version {v.version}: {v.isDraft ? "Draft" : v.status}
        {studio.live ? ` · learners see version ${studio.live.version}${studio.live.unpublishedAt ? ` (unpublished ${when(studio.live.unpublishedAt)}: hidden from new learners)` : ""}` : " · not published yet"}
        {" · "}{studio.modules.length} modules · recommended pace about 1 week per module, no time lock
      </p>
      {message && <p role="status" className="notice">{message}</p>}

      {!v.isDraft && can("build", role) && (
        <div className="notice">
          <p>This version is live, so it isn&apos;t edited in place. Start a new version to edit it: learners keep seeing this one until the new version is reviewed, approved by the Owner and published.</p>
          <button type="button" disabled={busy} onClick={() => act(() => call("POST", `${base}/new-version`), (r) => `Version ${r.version} started as a Draft. Edit it below.`)}>Start a new version</button>
        </div>
      )}

      <TierPicker slug={slug} current={v.sizeTier ?? null} modules={studio.modules.length} editable={editable} busy={busy} act={act} />

      <IncomeCheck findings={studio.findings} />

      <div className="studio__publish">
        <h3>Publish</h3>
        {studio.emptySlots > 0 && (
          <p className="notice" role="note">{studio.emptySlots} video slot{studio.emptySlots === 1 ? "" : "s"} {studio.emptySlots === 1 ? "has" : "have"} no approved video. The course can still be published; learners see &quot;Video coming&quot; there.</p>
        )}
        {studio.publishBlockers.length > 0 && (
          <ul className="small">{studio.publishBlockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        )}
        {owner ? (
          <p className="studio__row">
            <label>Reason (recorded) <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="primary" disabled={busy || !studio.canPublish || reason.trim().length < 5}
              onClick={() => act(() => verified("POST", `${base}/publication`, { reason }), (r) => `Published: ${r.lessons} lesson version(s) and ${r.items} practice item(s) went live.`).then((ok) => ok && setReason(""))}>
              Publish course
            </button>
            {live && (
              <button type="button" disabled={busy || reason.trim().length < 5}
                onClick={() => act(() => verified("DELETE", `${base}/publication`, { reason }), () => "Unpublished: hidden from new learners. Learners who started keep access and their progress.").then((ok) => ok && setReason(""))}>
                Unpublish
              </button>
            )}
          </p>
        ) : <p className="muted small">Only the Owner publishes or unpublishes a course, after approving every module.</p>}
      </div>

      {v.sizeTier && (
        <details className="studio__c2">
          <summary>Capstone and course notices</summary>
          <h3>Capstone</h3>
          <CapstoneEditor slug={slug} capstone={studio.capstone ?? null} business={!!studio.business} editable={editable} busy={busy} act={act} />
          <h3>Notices</h3>
          <NoticesEditor slug={slug} notices={studio.notices ?? { license: null, software: null }} editable={editable} busy={busy} act={act} />
        </details>
      )}

      <ol className="studio__modules">
        {studio.modules.map((m, i) => (
          <li key={m.id}>
            <ModuleEditor slug={slug} module={m} index={i} count={studio.modules.length} boosters={studio.boosters} owner={owner} editable={editable}
              busy={busy} act={act} verified={verified}
              onMove={(dir) => {
                const ids = studio.modules.map((x) => x.id);
                const j = i + dir;
                [ids[i], ids[j]] = [ids[j], ids[i]];
                return act(() => call("PUT", `${base}/modules/order`, { ids }), () => `Moved "${m.title}" to position ${j + 1}.`);
              }} />
          </li>
        ))}
      </ol>
      {editable && studio.modules.length < (v.sizeTier ? SIZE_TIERS[v.sizeTier].modules.max : 6) && <AddModule busy={busy} onAdd={(title) => act(() => call("POST", `${base}/modules`, { title }), () => `Added the module "${title}".`)} />}
    </section>
  );
}

function IncomeCheck({ findings }: { findings: Studio["findings"] }) {
  if (!findings.length) return <p className="muted small">Income-claims check: nothing found. Nothing in this version promises income or results.</p>;
  return (
    <div className="notice" role="note">
      <p><strong>Income-claims check: {findings.length} place{findings.length === 1 ? "" : "s"} to reword.</strong> A version with any of these can&apos;t go to review or be approved.</p>
      <ul className="small">
        {findings.map((f, i) => <li key={i}><strong>{f.where}</strong>: &quot;{f.text}&quot; ({f.claim}). <span className="muted">{f.excerpt}</span></li>)}
      </ul>
    </div>
  );
}

function AddModule({ busy, onAdd }: { busy: boolean; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <p className="studio__row">
      <label>New module title <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <button type="button" disabled={busy || title.trim().length < 3} onClick={() => { onAdd(title); setTitle(""); }}>Add a module</button>
    </p>
  );
}
