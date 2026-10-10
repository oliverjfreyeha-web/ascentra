"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { call } from "../../call";
import { meFrom } from "../../me";
import { importResultFrom, type ImportResult } from "../../import-api";
import { Loading } from "../../ui/loading";

/**
 * I1: the Owner's Import course tool. Paste the course file or choose it; "Check file" is a dry run that writes nothing;
 * "Create Draft" is enabled only after a clean check of exactly this text, and makes a new Draft version for the
 * Owner's usual review. The file is never shown back as HTML: every value on this page is plain text.
 */
const GROUPS: Record<string, string> = {
  format: "File format", course: "Course", sources: "Sources", modules: "Modules", items: "Items", capstone: "Capstone",
  income: "Income claims and attorney wording", links: "Links",
};
const KINDS: Record<string, string> = { video: "videos", quiz: "quizzes", assignment: "assignments", sandbox: "sandboxes", sequence: "sequences", booster: "boosters" };
const MAX = 2 * 1024 * 1024;

export function ImportPage() {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("pasted.json");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => r.json()).then((m) => setRole(meFrom(m)?.roleKey ?? null)).catch(() => setRole(null));
  }, []);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX) { setMessage(`"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB; 2 MB at most.`); return; }
    setText(await f.text());
    setFileName(f.name);
    setResult(null);
    setCheckedText(null);
    setMessage(`Loaded "${f.name}". Check it next.`);
  }
  async function run(mode: "check" | "create") {
    setBusy(true);
    setMessage(null);
    const r = await call("POST", mode === "check" ? "/api/v1/courses/import/check" : "/api/v1/courses/import", { fileName, content: text });
    setBusy(false);
    const v = importResultFrom(r);
    if (!v) { setMessage(r.reason ?? "Nothing was created."); return; }
    setResult(v);
    setCheckedText(v.ok ? text : null);
    if (mode === "check") setMessage(v.ok ? "The file is clean. Nothing has been created yet." : `${v.problems.length} problem${v.problems.length === 1 ? "" : "s"} to fix. Nothing was created.`);
    else setMessage(v.created ? `Created a Draft: version ${v.created.version}. Nothing was published or approved.` : `${v.problems.length} problem(s). Nothing was created.`);
  }

  if (role === undefined) return <Loading shape="list" />;
  if (role !== "owner") return <p role="status" className="ui-state ui-state--error">Only the Owner imports a course.</p>;
  const ready = !!result?.ok && checkedText === text && !result.created;
  const groups = result ? Object.entries(GROUPS).map(([key, label]) => ({ key, label, list: result.problems.filter((p) => p.group === key) })).filter((g) => g.list.length) : [];
  return (
    <>
      <section className="ui-block" aria-labelledby="file-h">
        <h2 id="file-h">The course file</h2>
        <label className="ui-stacked">
          Choose a file (.json, 2 MB at most)
          <input type="file" accept="application/json,.json" onChange={(e) => void choose(e)} disabled={busy} />
        </label>
        <label className="ui-stacked">
          Or paste it here
          <textarea className="import__text" rows={10} value={text} spellCheck={false}
            onChange={(e) => { setText(e.target.value); setFileName("pasted.json"); }} aria-describedby="import-hint" />
        </label>
        <p id="import-hint" className="ui-hint">The file is read as data only: HTML and scripts are removed, links must be https, and nothing in it is opened or run.</p>
        <p className="ui-actions">
          <button type="button" disabled={busy || !text.trim()} onClick={() => void run("check")}>Check file</button>{" "}
          <button type="button" className="primary" disabled={busy || !ready} aria-describedby="create-hint" onClick={() => void run("create")}>Create Draft</button>
        </p>
        <p id="create-hint" className="ui-hint">Create Draft is on only after a clean check of this exact text. It makes a new Draft version; it never publishes or approves anything.</p>
        {message && <p role="status">{message}</p>}
      </section>

      {result && (
        <section className="ui-block" aria-labelledby="result-h">
          <h2 id="result-h">{result.created ? "Created" : result.ok ? "Ready to create" : "Problems"}</h2>
          <p className="small muted">File: {fileName} · {Math.max(1, Math.round(result.bytes / 1024))} KB · sha256 {result.sha256.slice(0, 16)}…</p>
          <h3>What {result.created ? "was" : "would be"} created</h3>
          <ul className="import__summary">
            <li>Topic: {result.summary.topic ?? "unknown"}{result.summary.newDraftVersion ? " (it has a Draft already: this becomes the next version)" : ""}</li>
            <li>Course: {result.summary.title ?? "untitled"}{result.summary.sizeTier ? ` · ${result.summary.sizeTier}` : ""}</li>
            <li>{result.summary.modules} modules, {result.summary.lessons} lessons (Draft lesson versions)</li>
            <li>Items: {Object.entries(result.summary.items).map(([k, n]) => `${n} ${KINDS[k] ?? k}`).join(", ") || "none"}</li>
            <li>{result.summary.videoSlots} video slots, each &ldquo;Waiting for video&rdquo;</li>
            <li>{result.summary.sources} sources (new ones are added as &ldquo;proposed&rdquo; for the usual approval)</li>
            <li>{result.summary.resources} resources ({result.summary.resourcesHidden} not shown to learners until their terms are checked)</li>
            <li>The capstone{result.summary.notices ? ` and ${result.summary.notices} notice${result.summary.notices === 1 ? "" : "s"}` : ""}</li>
          </ul>
          {result.created && (
            <p className="ui-actions">
              <Link href={result.created.editor} className="ui-btn ui-btn--primary">Open in the course editor</Link>{" "}
              <Link href={result.created.checklist} className="ui-btn ui-btn--secondary">Owner review checklist</Link>
            </p>
          )}
          {groups.length > 0 && (
            <>
              <h3>{result.problems.length} problem{result.problems.length === 1 ? "" : "s"}</h3>
              {groups.map((g) => (
                <section key={g.key} aria-labelledby={`pg-${g.key}`}>
                  <h4 id={`pg-${g.key}`}>{g.label} ({g.list.length})</h4>
                  <ul className="import__problems">
                    {g.list.map((p, i) => <li key={i}><code>{p.path}</code>: {p.message}</li>)}
                  </ul>
                </section>
              ))}
            </>
          )}
          {result.warnings.length > 0 && (
            <>
              <h3>Notes ({result.warnings.length})</h3>
              <ul className="import__problems">{result.warnings.map((w, i) => <li key={i}><code>{w.path}</code>: {w.message}</li>)}</ul>
            </>
          )}
        </section>
      )}
    </>
  );
}
