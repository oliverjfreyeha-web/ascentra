"use client";

import { useRef, useState, type DragEvent } from "react";
import { call, when, type ApiResult } from "../../../call";
import { MIN_TRANSCRIPT_CHARS, SLOT_STATUS, VIDEO_MAX_BYTES, mb, tooLarge, uploadStartFrom, type Brief, type SlotView } from "../../../studio-api";

type Act = (run: () => Promise<ApiResult>, okText: (r: ApiResult) => string) => Promise<boolean>;
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const TYPES = ["video/mp4", "video/webm"];

/** Sends the file straight to storage with the one-time link, reporting progress. Resolves with the HTTP status. */
function sendFile(url: string, file: File, onProgress: (pct: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

/**
 * C1: one video slot. The brief (what the video must cover, to copy into the tool the Owner records with), the drop box
 * (mp4 or webm, checked by content on the server, 50 MB at most), the transcript, and the Owner's approval. Replacing a
 * video keeps the old record; the list below shows every upload.
 */
export function VideoSlotEditor({ slug, slot: s, owner, busy, act }: { slug: string; slot: SlotView; owner: boolean; busy: boolean; act: Act }) {
  const base = `/api/v1/courses/${encodeURIComponent(slug)}/videos/${s.id}`;
  const [copied, setCopied] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(s.transcript);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = `slot-${s.id}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(s.briefText);
      setCopied("Brief copied.");
    } catch {
      setCopied("Couldn't copy here: select the brief text and copy it.");
    }
  }

  async function upload(file: File) {
    setProblem(null);
    if (file.size > VIDEO_MAX_BYTES) return setProblem(tooLarge(file.size));
    if (file.type && !TYPES.includes(file.type) && !/\.(mp4|webm)$/i.test(file.name)) return setProblem("Upload an mp4 or webm video.");
    const start = await call("POST", `${base}/upload`, { name: file.name, size: file.size, type: file.type });
    const link = start._status === 201 ? uploadStartFrom(start) : null;
    if (!link) return setProblem(start.reason ?? "The upload couldn't start. Nothing was uploaded.");
    setProgress(0);
    const status = await sendFile(link.url, file, setProgress);
    setProgress(null);
    if (status < 200 || status >= 300) return setProblem("The file didn't reach storage. Check your connection and try again.");
    await act(() => call("POST", `${base}/upload/${link.uploadId}`), () => "Video uploaded and checked. Add the transcript, watch it, then approve it.");
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <section className="studio__slot" aria-labelledby={titleId}>
      <h5 id={titleId}>{s.title} <span className={`studio__badge${s.status === "approved" ? " is-ok" : ""}`}>{SLOT_STATUS[s.status]}</span></h5>
      {s.status === "approved" && s.approvedAt && <p className="muted small">Approved by the Owner on {new Date(s.approvedAt).toLocaleDateString()}.</p>}
      {s.file && <p className="muted small">Video: {s.file.name ?? "uploaded file"} · {mb(s.file.size)} · uploaded {when(s.file.uploadedAt)}</p>}

      <details>
        <summary>Brief {s.briefBy === "ai" && !s.briefEditedAt ? "(proposed by AI from the course's sources)" : ""}</summary>
        <pre className="studio__brief">{s.briefText}</pre>
        <p className="studio__row">
          <button type="button" onClick={copy}>Copy brief</button>
          {copied && <span role="status" className="small">{copied}</span>}
        </p>
        {owner && <BriefForm title={s.title} brief={s.brief} busy={busy} onSave={(body) => act(() => call("PATCH", base, body), () => "Brief saved.")} />}
      </details>

      {owner && (
        <>
          <div className={`studio__drop${over ? " is-over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <label>
              {s.file ? "Replace the video" : "Upload the video"} (mp4 or webm, up to {mb(VIDEO_MAX_BYTES)}): drop it here, or choose a file
              <input ref={input} type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={busy || progress !== null}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            </label>
            {progress !== null && <progress max={100} value={progress} aria-label="Upload progress">{progress}%</progress>}
          </div>
          {problem && <p role="alert" className="notice">{problem}</p>}

          <label className="studio__transcript">Transcript or captions (required before approval; learners can read it instead of watching)
            <textarea rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
          </label>
          <p className="studio__row">
            <button type="button" disabled={busy || transcript === s.transcript} onClick={() => act(() => call("PATCH", base, { transcript }), () => "Transcript saved.")}>Save transcript</button>
            {s.file && (
              <button type="button" disabled={busy} onClick={async () => {
                const r = await call("GET", `${base}/preview`);
                if (r._status === 200 && typeof r.url === "string") setPreview({ url: r.url, mime: String(r.mime) });
                else setProblem(r.reason ?? "No video to preview.");
              }}>Watch it</button>
            )}
            {s.status === "uploaded" && (
              <button type="button" className="primary" disabled={busy || s.transcript.trim().length < MIN_TRANSCRIPT_CHARS} onClick={() => act(() => call("POST", `${base}/approve`), () => "Video approved. Learners of the published course can play it.")}>Approve video</button>
            )}
            {s.status === "uploaded" && s.transcript.trim().length < MIN_TRANSCRIPT_CHARS && <span className="muted small">Save a transcript first.</span>}
          </p>
          {preview && (
            // Never autoplays; the Owner presses play.
            <video className="studio__preview" controls preload="metadata" src={preview.url} />
          )}
        </>
      )}

      {s.history.length > 0 && (
        <details>
          <summary>Uploads ({s.history.length})</summary>
          <ul className="small">
            {s.history.map((h) => (
              <li key={h.id}>{h.name ?? "a file"} · {mb(h.size)} · {when(h.uploadedAt)} · {h.status}{h.replacedAt ? ` (replaced ${when(h.replacedAt)})` : ""}{h.reason ? `: ${h.reason}` : ""}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BriefForm({ title, brief, busy, onSave }: { title: string; brief: Brief; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [t, setT] = useState(title);
  const [purpose, setPurpose] = useState(brief.purpose ?? "");
  const [points, setPoints] = useState((brief.points ?? []).map((p) => p.text).join("\n"));
  const [minutes, setMinutes] = useState(brief.targetMinutes ? String(brief.targetMinutes) : "");
  const [tone, setTone] = useState(brief.tone ?? "");
  const [onScreen, setOnScreen] = useState((brief.onScreen ?? []).join("\n"));
  const [avoid, setAvoid] = useState((brief.avoid ?? []).join("\n"));
  return (
    <fieldset className="studio__brief-form">
      <legend>Edit the brief</legend>
      <label>Video title <input value={t} onChange={(e) => setT(e.target.value)} /></label>
      <label>What it&apos;s for <input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
      <label>Points to cover, in order (one per line; a point you keep keeps its sources) <textarea rows={5} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      <label>Target length (minutes) <input type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
      <label>Tone <input value={tone} onChange={(e) => setTone(e.target.value)} /></label>
      <label>Show on screen (one per line; made-up examples only) <textarea rows={3} value={onScreen} onChange={(e) => setOnScreen(e.target.value)} /></label>
      <label>Avoid (one per line) <textarea rows={3} value={avoid} onChange={(e) => setAvoid(e.target.value)} /></label>
      <button type="button" disabled={busy} onClick={() => onSave({
        title: t, brief: { purpose, points: lines(points).map((text) => ({ text })), targetMinutes: minutes ? Number(minutes) : null, tone, onScreen: lines(onScreen), avoid: lines(avoid) },
      })}>Save brief</button>
    </fieldset>
  );
}
