"use client";

import { useState } from "react";
import { call, when, type ApiResult } from "../../../call";
import { courseApi, BOOSTERS_MAX, ITEM_PARTS, PART_NAMES, RECIPE_CAPS, type Booster, type StudioModule } from "../../../studio-api";
import type { LessonBody } from "../../../courses-api";
import { VideoSlotEditor } from "./video-slot";

type Act = (run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) => Promise<boolean>;
type Verified = (method: string, url: string, body?: unknown) => Promise<ApiResult>;
const PARTS = ["videos", "quizzes", "assignments", "sandboxes", "sequences"] as const;

/** C1: one module in the studio: its recipe, lessons, practice, video slots, and the Owner's decision. */
export function ModuleEditor({ slug, module: m, index, count, boosters, owner, editable, busy, act, verified, onMove }: {
  slug: string; module: StudioModule; index: number; count: number; boosters: Booster[]; owner: boolean; editable: boolean; busy: boolean;
  act: Act; verified: Verified; onMove: (dir: -1 | 1) => Promise<boolean>;
}) {
  const base = courseApi(slug);
  const st = m.state;
  const [note, setNote] = useState("");
  const status = st.review?.current ? `Approved by the Owner on ${new Date(st.review.decidedAt).toLocaleDateString()}`
    : st.review?.decision === "sent_back" ? "Sent back to Draft" : st.ready ? "Ready for the Owner" : "Not ready";
  const headingId = `mod-${m.id}`;

  const moveLesson = (li: number, dir: -1 | 1) => {
    const ids = m.lessons.map((l) => l.id);
    const j = li + dir;
    [ids[li], ids[j]] = [ids[j], ids[li]];
    return act(() => call("PUT", `${base}/modules/${m.id}/lessons/order`, { ids }), () => `Moved "${m.lessons[li].title}" to position ${j + 1} in this module.`);
  };

  return (
    <article className="studio__module" aria-labelledby={headingId}>
      <header className="studio__module-head">
        <h3 id={headingId}>Module {m.position}: {m.title}{m.stage ? <span className="muted small"> · {m.stage}</span> : null}</h3>
        <span className={`studio__badge${st.review?.current ? " is-ok" : st.review?.decision === "sent_back" ? " is-back" : ""}`}>{status}</span>
        {editable && (
          <span className="studio__move">
            <button type="button" className="link" disabled={busy || index === 0} onClick={() => onMove(-1)} aria-label={`Move module ${m.position} up`}>Move up</button>
            <button type="button" className="link" disabled={busy || index === count - 1} onClick={() => onMove(1)} aria-label={`Move module ${m.position} down`}>Move down</button>
          </span>
        )}
      </header>
      <p className="muted small">Recommended pace: {m.recommendedPace} (no time lock). Practice: {st.coverage.types} kind(s) of activity{st.coverage.varietyOk ? "" : ", needs at least 3"}.</p>
      <Coverage module={m} />
      {st.review?.decision === "sent_back" && st.review.note && <p className="notice">Sent back by the Owner ({when(st.review.decidedAt)}): {st.review.note}</p>}
      {st.blockers.length > 0 && (
        <details>
          <summary>Not ready for the Owner&apos;s approval: {st.blockers.length} thing{st.blockers.length === 1 ? "" : "s"} to finish</summary>
          <ul className="small">{st.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </details>
      )}

      {editable && <ModuleFields module={m} boosters={boosters} busy={busy} onSave={(body) => act(() => call("PATCH", `${base}/modules/${m.id}`, body), () => "Module saved.")} />}

      <h4>Lessons</h4>
      <ol>
        {m.lessons.map((l, li) => (
          <li key={l.id}>
            <LessonRow lesson={l} editable={editable} busy={busy}
              onSave={(body) => act(() => call("PATCH", `${base}/lessons/${l.id}/text`, body), (r) => `Saved "${l.title}"${Number(r.uncited) ? `; ${r.uncited} paragraph(s) have no source and are shown that way` : ""}.`)}
              onSubmit={(id) => act(() => call("POST", `${base}/versions/${id}/submit`), () => "Submitted for review.")} />
            {editable && m.lessons.length > 1 && (
              <span className="studio__move">
                <button type="button" className="link" disabled={busy || li === 0} onClick={() => moveLesson(li, -1)} aria-label={`Move lesson "${l.title}" up`}>Move up</button>
                <button type="button" className="link" disabled={busy || li === m.lessons.length - 1} onClick={() => moveLesson(li, 1)} aria-label={`Move lesson "${l.title}" down`}>Move down</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {editable && <AddLesson busy={busy} onAdd={(title) => act(() => call("POST", `${base}/modules/${m.id}/lessons`, { title }), () => `Added the lesson "${title}".`)} />}

      <h4>Practice</h4>
      {!m.items.length && <p className="muted small">No practice items yet. Draft them from a lesson in the course builder below.</p>}
      <ul className="studio__items">
        {m.items.map((it) => (
          <li key={it.id}>
            <span>{it.prompt}</span>{" "}
            <span className="muted small">· {it.type.replace(/_/g, " ")} · {it.status}</span>{" "}
            {editable && it.status === "draft" ? (
              <PartPicker item={it} boosters={boosters} busy={busy}
                onPick={(part, booster) => act(() => call("PUT", `${base}/activities/${it.id}/part`, { part, booster }), () => "Practice item moved.")} />
            ) : <span className="small">{partLabel(it.part, it.booster, boosters)}</span>}
            {editable && (it.status === "approved" || it.status === "rejected") && (
              <> <button type="button" className="link" disabled={busy} onClick={() => act(() => call("POST", `${base}/activities/${it.id}/reopen`), () => "Reopened as a Draft: edit it in the practice library below; it needs reviewing again.")}>Reopen to edit</button></>
            )}
          </li>
        ))}
      </ul>

      <h4>Videos</h4>
      {m.slots.map((s) => <VideoSlotEditor key={s.id} slug={slug} slot={s} owner={owner} busy={busy} act={act} />)}
      {owner && m.slots.length < RECIPE_CAPS.videos.max && (
        <button type="button" className="link" disabled={busy} onClick={() => act(() => call("POST", `${base}/videos`, { moduleId: m.id, title: `${m.title}: video ${m.slots.length + 1}` }), () => "Video slot added. Write its brief.")}>Add a video slot</button>
      )}

      {owner && (
        <div className="studio__decide">
          <h4>Your review</h4>
          {st.review?.current ? <p className="small">You approved this module as it is now. A change needs your approval again.</p> : (
            <p className="studio__row">
              <button type="button" className="primary" disabled={busy || !st.ready} onClick={() => act(() => verified("POST", `${base}/modules/${m.id}/review`, { decision: "approve" }), () => `Module ${m.position} approved.`)}>Approve</button>
              {!st.ready && <span className="muted small">Approve becomes available when everything above is finished.</span>}
            </p>
          )}
          <p className="studio__row">
            <label>Note for the builders <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <button type="button" disabled={busy || note.trim().length < 5}
              onClick={() => act(() => verified("POST", `${base}/modules/${m.id}/review`, { decision: "send_back", note }), () => `Module ${m.position} sent back with your note.`).then((ok) => ok && setNote(""))}>
              Send back with a note
            </button>
          </p>
        </div>
      )}
    </article>
  );
}

function partLabel(part: string, booster: string | null, boosters: Booster[]) {
  if (part === "booster") return `Learning booster: ${boosters.find((b) => b.key === booster)?.name ?? booster ?? "?"}`;
  return ITEM_PARTS.find(([k]) => k === part)?.[1] ?? part;
}

function Coverage({ module: m }: { module: StudioModule }) {
  const c = m.state.coverage;
  return (
    <ul className="studio__coverage small" aria-label="Recipe">
      {PARTS.map((p) => {
        const want = Number(m.recipe[p] ?? 1);
        const have = c.counts[p] ?? 0;
        return <li key={p} className={have >= want ? "is-ok" : ""}>{PART_NAMES[p]}: {have} of {want}</li>;
      })}
      <li className={c.boostersMissing.length ? "" : "is-ok"}>Boosters: {(m.recipe.boosters ?? []).length - c.boostersMissing.length} of {(m.recipe.boosters ?? []).length}</li>
    </ul>
  );
}

function ModuleFields({ module: m, boosters, busy, onSave }: { module: StudioModule; boosters: Booster[]; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(m.title);
  const [stage, setStage] = useState(m.stage ?? "");
  const [pace, setPace] = useState(m.recommendedPace);
  const [recipe, setRecipe] = useState(() => Object.fromEntries(PARTS.map((p) => [p, Number(m.recipe[p] ?? 1)])) as Record<(typeof PARTS)[number], number>);
  const [picked, setPicked] = useState<string[]>(m.recipe.boosters ?? []);
  return (
    <details className="studio__fields">
      <summary>Edit module and recipe</summary>
      <p className="studio__row">
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Stage <input value={stage} onChange={(e) => setStage(e.target.value)} /></label>
        <label>Recommended pace <input value={pace} onChange={(e) => setPace(e.target.value)} /></label>
      </p>
      <fieldset>
        <legend>Recipe (how many of each)</legend>
        <p className="studio__row">
          {PARTS.map((p) => (
            <label key={p}>{PART_NAMES[p]} <input type="number" min={RECIPE_CAPS[p].min} max={RECIPE_CAPS[p].max} value={recipe[p]}
              onChange={(e) => setRecipe({ ...recipe, [p]: Number(e.target.value) })} /></label>
          ))}
        </p>
      </fieldset>
      <fieldset>
        <legend>Learning boosters (up to {BOOSTERS_MAX})</legend>
        <p className="studio__row">
          {boosters.map((b) => (
            <label key={b.key} className="studio__check">
              <input type="checkbox" checked={picked.includes(b.key)} disabled={!picked.includes(b.key) && picked.length >= BOOSTERS_MAX}
                onChange={(e) => setPicked(e.target.checked ? [...picked, b.key] : picked.filter((k) => k !== b.key))} />
              {b.name}
            </label>
          ))}
        </p>
      </fieldset>
      <button type="button" disabled={busy} onClick={() => onSave({ title, stage, pace, recipe: { ...recipe, boosters: picked } })}>Save module</button>
    </details>
  );
}

function PartPicker({ item, boosters, busy, onPick }: { item: StudioModule["items"][number]; boosters: Booster[]; busy: boolean; onPick: (part: string, booster?: string) => void }) {
  const value = item.part === "booster" ? `booster:${item.booster}` : item.part;
  return (
    <label className="small">Part{" "}
      <select value={value} disabled={busy} onChange={(e) => {
        const [part, booster] = e.target.value.split(":");
        onPick(part, booster);
      }}>
        {ITEM_PARTS.filter(([k]) => k !== "booster").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        {boosters.filter((b) => b.itemTypes.includes(item.type)).map((b) => <option key={b.key} value={`booster:${b.key}`}>Booster: {b.name}</option>)}
      </select>
    </label>
  );
}

function AddLesson({ busy, onAdd }: { busy: boolean; onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <p className="studio__row">
      <label>New lesson title <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <button type="button" disabled={busy || title.trim().length < 3} onClick={() => { onAdd(title); setTitle(""); }}>Add a lesson</button>
    </p>
  );
}

function LessonRow({ lesson: l, editable, busy, onSave, onSubmit }: {
  lesson: StudioModule["lessons"][number]; editable: boolean; busy: boolean; onSave: (body: Record<string, unknown>) => void; onSubmit: (versionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const state = l.open ? `v${l.open.version} ${l.open.status === "review" ? (l.open.verified ? "in review, verified" : "in review") : "Draft"}` : l.published ? `v${l.published.version} published` : "not written yet";
  return (
    <div className="studio__lesson">
      <p><strong>{l.title}</strong> <span className="muted small">· {state}{l.published && l.open ? ` · learners see v${l.published.version}` : ""}</span></p>
      {l.open?.returnedNote && l.open.status === "draft" && <p className="notice small">{l.open.returnedNote}</p>}
      {editable && l.open?.status !== "review" && (
        <p className="studio__row">
          <button type="button" className="link" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? "Close the text editor" : "Edit text"}</button>
          {l.open?.status === "draft" && <button type="button" className="link" disabled={busy} onClick={() => onSubmit(l.open!.id)}>Submit for review</button>}
        </p>
      )}
      {editing && <LessonText title={l.title} body={l.text?.body ?? null} busy={busy} onSave={(b) => { onSave(b); setEditing(false); }} />}
    </div>
  );
}

/** Edits a lesson's words in place; each paragraph keeps its citations. An empty paragraph is removed. */
function LessonText({ title, body, busy, onSave }: { title: string; body: LessonBody | null; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const start: LessonBody = body ?? { summary: "", sections: [], takeaways: [] };
  const [t, setT] = useState(title);
  const [summary, setSummary] = useState(start.summary);
  const [sections, setSections] = useState(start.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs.map((p) => p.text) })));
  const [takeaways, setTakeaways] = useState(start.takeaways.map((p) => p.text));
  const save = () => {
    const headings: Record<string, string> = {};
    const paragraphs: Record<string, string> = {};
    sections.forEach((s, si) => {
      if (s.heading !== start.sections[si]?.heading) headings[si] = s.heading;
      // From the end, so removing one doesn't shift the ones still to send.
      for (let pi = s.paragraphs.length - 1; pi >= 0; pi--) if (s.paragraphs[pi] !== start.sections[si]?.paragraphs[pi]?.text) paragraphs[`${si}.${pi}`] = s.paragraphs[pi];
    });
    const tk: Record<string, string> = {};
    for (let ti = takeaways.length - 1; ti >= 0; ti--) if (takeaways[ti] !== start.takeaways[ti]?.text) tk[ti] = takeaways[ti];
    onSave({ ...(t !== title ? { title: t } : {}), ...(summary !== start.summary ? { summary } : {}), headings, paragraphs, takeaways: tk });
  };
  return (
    <div className="studio__text">
      <label>Lesson title <input value={t} onChange={(e) => setT(e.target.value)} /></label>
      <label>Summary <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
      {sections.map((s, si) => (
        <fieldset key={si}>
          <legend>Section {si + 1}</legend>
          <label>Heading <input value={s.heading} onChange={(e) => setSections(sections.map((x, i) => (i === si ? { ...x, heading: e.target.value } : x)))} /></label>
          {s.paragraphs.map((p, pi) => (
            <label key={pi}>Paragraph {pi + 1}{start.sections[si]?.paragraphs[pi]?.refs.length ? ` (cites ${start.sections[si].paragraphs[pi].refs.map((r) => `[${r}]`).join(" ")})` : " (no source)"}
              <textarea rows={3} value={p} onChange={(e) => setSections(sections.map((x, i) => (i === si ? { ...x, paragraphs: x.paragraphs.map((y, j) => (j === pi ? e.target.value : y)) } : x)))} />
            </label>
          ))}
          {s.paragraphs.length < 6 && <button type="button" className="link" onClick={() => setSections(sections.map((x, i) => (i === si ? { ...x, paragraphs: [...x.paragraphs, ""] } : x)))}>Add a paragraph</button>}
        </fieldset>
      ))}
      {sections.length < 8 && <button type="button" className="link" onClick={() => setSections([...sections, { heading: "", paragraphs: [""] }])}>Add a section</button>}
      <fieldset>
        <legend>Takeaways</legend>
        {takeaways.map((k, ti) => (
          <label key={ti}>Takeaway {ti + 1} <textarea rows={2} value={k} onChange={(e) => setTakeaways(takeaways.map((y, j) => (j === ti ? e.target.value : y)))} /></label>
        ))}
        {takeaways.length < 6 && <button type="button" className="link" onClick={() => setTakeaways([...takeaways, ""])}>Add a takeaway</button>}
      </fieldset>
      <p className="muted small">New or rewritten text has no source until a cited version is drafted; it is shown to learners as having no source. Text that promises income or results can&apos;t be saved.</p>
      <button type="button" disabled={busy} onClick={save}>Save text</button>
    </div>
  );
}
