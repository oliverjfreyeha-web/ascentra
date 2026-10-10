"use client";

import { useState, type FormEvent } from "react";
import { call, type ApiResult } from "../../../call";
import { courseApi, type Studio } from "../../../studio-api";
import { SIZE_TIERS, SIZE_TIER_KEYS, type SizeTier } from "@/lib/courses/structure";
import { IMPORTANCE, MISSION_TYPES } from "@/lib/progress/config";

/**
 * C2 in the course studio: the size tier (its module count must fit), each item's and video's importance label (a
 * "Very important" one with its Notebook note; required before a module goes to review), the real-world mission kind
 * of a practice item, the course notices (shown to learners once per course), and the capstone. Plain forms.
 */
type Act = (run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) => Promise<boolean>;

export function TierPicker({ slug, current, modules, editable, busy, act }: { slug: string; current: SizeTier | null; modules: number; editable: boolean; busy: boolean; act: Act }) {
  const [tier, setTier] = useState<string>(current ?? "");
  if (!editable) return <p className="small muted">Size: {current ? `${SIZE_TIERS[current].label} (${SIZE_TIERS[current].modules.min} to ${SIZE_TIERS[current].modules.max} modules, ${SIZE_TIERS[current].hoursPerWeek.min} to ${SIZE_TIERS[current].hoursPerWeek.max} hours a week)` : "not set (earlier course: every module open)"}.</p>;
  return (
    <p className="studio__row">
      <label>Course size <select value={tier} onChange={(e) => setTier(e.target.value)}>
        <option value="">Choose…</option>
        {SIZE_TIER_KEYS.map((k) => <option key={k} value={k}>{SIZE_TIERS[k].label}: {SIZE_TIERS[k].modules.min} to {SIZE_TIERS[k].modules.max} modules, {SIZE_TIERS[k].hoursPerWeek.min} to {SIZE_TIERS[k].hoursPerWeek.max} h/week</option>)}
      </select></label>
      <button type="button" disabled={busy || !tier || tier === current} onClick={() => act(() => call("PUT", `${courseApi(slug)}/size-tier`, { tier }), () => `Size set to ${SIZE_TIERS[tier as SizeTier].label}.`)}>Save size</button>
      <span className="small muted">This course has {modules} modules.</span>
    </p>
  );
}

/** The label (and Notebook note, and for practice the mission kind) of one item or video. */
export function LabelEditor({ url, method, current, editable, busy, act, mission, name }: {
  url: string; method: "PUT" | "PATCH"; current: { importance: string | null; notebookNote: string | null; missionType?: string | null };
  editable: boolean; busy: boolean; act: Act; mission: boolean; name: string;
}) {
  const [importance, setImportance] = useState(current.importance ?? "");
  const [note, setNote] = useState(current.notebookNote ?? "");
  const [missionType, setMissionType] = useState(current.missionType ?? "");
  const label = current.importance ? IMPORTANCE[current.importance as keyof typeof IMPORTANCE]?.label ?? current.importance : "No label yet";
  if (!editable) return <span className="small">{label}{current.missionType ? ` · mission: ${MISSION_TYPES[current.missionType as keyof typeof MISSION_TYPES]?.label ?? current.missionType}` : ""}</span>;
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(() => call(method, url, { importance: importance || null, notebookNote: note.trim() || null, ...(mission ? { missionType: missionType || null } : {}) }), () => `Label saved: ${name}.`);
  }
  const needsNote = importance === "very_important";
  return (
    <form className="studio__row" aria-label={`Label for ${name}`} onSubmit={submit}>
      <label>Importance <select value={importance} onChange={(e) => setImportance(e.target.value)}>
        <option value="">Choose…</option>
        {Object.entries(IMPORTANCE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select></label>
      {needsNote && <label>Notebook note (2 or 3 sentences) <textarea rows={2} minLength={20} maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
      {mission && <label>Real-world mission <select value={missionType} onChange={(e) => setMissionType(e.target.value)}>
        <option value="">None</option>
        {Object.entries(MISSION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select></label>}
      <button type="submit" disabled={busy || !importance || (needsNote && note.trim().length < 20)}>Save label<span className="sr-only">: {name}</span></button>
    </form>
  );
}

export function NoticesEditor({ slug, notices, editable, busy, act }: { slug: string; notices: { license: string | null; software: string | null }; editable: boolean; busy: boolean; act: Act }) {
  const [license, setLicense] = useState(notices.license ?? "");
  const [software, setSoftware] = useState(notices.software ?? "");
  if (!editable) return (
    <div className="small">
      <p>Business license notice: {notices.license ?? "none"}</p>
      <p>Software or AI plan notice: {notices.software ?? "none"}</p>
    </div>
  );
  return (
    <form className="ui-form" aria-label="Course notices" onSubmit={(e) => { e.preventDefault(); void act(() => call("PUT", `${courseApi(slug)}/notices`, { license: license.trim() || null, software: software.trim() || null }), () => "Notices saved."); }}>
      <p className="small muted">Up to two notices, each shown to a learner once per course. General information only: not sponsored, no legal advice, no income claims.</p>
      <label>Business license notice <textarea rows={2} maxLength={600} value={license} onChange={(e) => setLicense(e.target.value)} /></label>
      <label>Software or AI plan notice <textarea rows={2} maxLength={600} value={software} onChange={(e) => setSoftware(e.target.value)} /></label>
      <p className="ui-actions"><button type="submit" disabled={busy}>Save notices</button></p>
    </form>
  );
}

type Cap = NonNullable<StudioC2["capstone"]>;
export type StudioC2 = Studio & {
  version: (NonNullable<Studio["version"]> & { sizeTier?: SizeTier | null }) | null;
  capstone?: { title: string; brief: string; deliverables: string[]; checklist: string[]; automation: { what: string; prompts: string[]; plans: { name: string; price: string; sourceUrl: string; checkedOn: string }[] } | null } | null;
  business?: boolean; notices?: { license: string | null; software: string | null };
};
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function CapstoneEditor({ slug, capstone, business, editable, busy, act }: { slug: string; capstone: Cap | null; business: boolean; editable: boolean; busy: boolean; act: Act }) {
  const [title, setTitle] = useState(capstone?.title ?? "");
  const [brief, setBrief] = useState(capstone?.brief ?? "");
  const [deliverables, setDeliverables] = useState((capstone?.deliverables ?? []).join("\n"));
  const [checklist, setChecklist] = useState((capstone?.checklist ?? []).join("\n"));
  const [what, setWhat] = useState(capstone?.automation?.what ?? "");
  const [prompts, setPrompts] = useState((capstone?.automation?.prompts ?? []).join("\n---\n"));
  const [plans, setPlans] = useState((capstone?.automation?.plans ?? []).map((p) => `${p.name} | ${p.price} | ${p.sourceUrl} | ${p.checkedOn}`).join("\n"));
  if (!editable) return capstone ? <p className="small">Capstone: {capstone.title} · {capstone.deliverables.length} deliverable(s) · {capstone.checklist.length} self-check item(s){capstone.automation ? " · Automation with AI" : ""}</p> : <p className="small muted">No capstone yet.</p>;
  function submit(e: FormEvent) {
    e.preventDefault();
    const automation = what.trim() || business ? {
      what, prompts: prompts.split(/\n-{3,}\n/).map((p) => p.trim()).filter(Boolean),
      plans: lines(plans).map((l) => { const [name, price, sourceUrl, checkedOn] = l.split("|").map((x) => x.trim()); return { name, price, sourceUrl, checkedOn }; }),
    } : null;
    void act(() => call("PUT", `${courseApi(slug)}/capstone`, { title, brief, deliverables: lines(deliverables), checklist: lines(checklist), automation }), () => "Capstone saved.");
  }
  return (
    <form className="ui-form" aria-label="Capstone" onSubmit={submit}>
      <p className="small muted">Required: &ldquo;Course complete&rdquo; means every module done plus this capstone. No income claims.</p>
      <label>Title <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Brief <textarea rows={2} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} /></label>
      <label>Deliverables (one per line) <textarea rows={3} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} /></label>
      <label>Self-check list (one per line) <textarea rows={3} value={checklist} onChange={(e) => setChecklist(e.target.value)} /></label>
      <fieldset>
        <legend>Automation with AI{business ? " (required for a business course)" : " (optional)"}</legend>
        <label>What gets automated <textarea rows={2} maxLength={1000} value={what} onChange={(e) => setWhat(e.target.value)} /></label>
        <label>Master prompts (separate prompts with a line of ---) <textarea rows={4} value={prompts} onChange={(e) => setPrompts(e.target.value)} /></label>
        <label>Top AI plans, up to 3 (one per line: name | price | https source | checked on YYYY-MM-DD). Leave empty to show &ldquo;a paid plan may be needed&rdquo;. <textarea rows={3} value={plans} onChange={(e) => setPlans(e.target.value)} /></label>
      </fieldset>
      <p className="ui-actions"><button type="submit" disabled={busy || title.trim().length < 3}>Save capstone</button></p>
    </form>
  );
}
