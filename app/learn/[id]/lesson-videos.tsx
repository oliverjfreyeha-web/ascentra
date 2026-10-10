"use client";

import { useId, useState } from "react";
import { call } from "../../call";
import { NeoVideo } from "../../ui/neo";
import { videoLinkFrom, type LessonVideo } from "../../studio-api";
import type { LessonProgress } from "../../progress-api";

/**
 * C1: the lesson's videos, made by the Owner. An approved video plays in the course UI kit's bezel through a link that
 * works for ten minutes; it never plays by itself, and its transcript is right below. A slot without an approved video
 * says "Video coming" in plain words, never a fake player.
 * C2: each video shows its importance label; watched to the end, it counts as done (the server records it).
 */
export function LessonVideos({ videos, progress, onWatched }: { videos: LessonVideo[]; progress?: LessonProgress | null; onWatched?: () => void }) {
  if (!videos.length) return null;
  return (
    <section aria-label="Videos" className="ui-lesson-videos">
      {videos.map((v) => (v.state === "ready" ? <ReadyVideo key={v.id} video={v} item={progress?.items.find((i) => i.kind === "video" && i.id === v.id) ?? null} reason={progress?.module.reason ?? null} onWatched={onWatched} /> : (
        <p key={v.id} className="ui-video-coming"><strong>{v.title}</strong>: Video coming.</p>
      )))}
    </section>
  );
}

function ReadyVideo({ video, item, reason, onWatched }: { video: LessonVideo; item: LessonProgress["items"][number] | null; reason: string | null; onWatched?: () => void }) {
  const [src, setSrc] = useState<{ url: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const transcriptId = useId();
  const [watched, setWatched] = useState<string | null>(null);
  async function ended() {
    if (!item || item.done) return;
    const r = await call("POST", `/api/v1/learn/videos/${encodeURIComponent(video.id)}/watched`, {});
    setWatched(r._status === 200 ? "Watched: counts as done." : r.reason ?? null);
    if (r._status === 200) onWatched?.();
  }
  async function load() {
    setBusy(true);
    const r = await call("GET", `/api/v1/learn/videos/${encodeURIComponent(video.id)}`);
    setBusy(false);
    const link = r._status === 200 ? videoLinkFrom(r) : null;
    if (link) setSrc({ url: link.url, mime: link.mime });
    else setProblem(r.reason ?? "The video can't be played right now. Its transcript is below.");
  }
  return (
    <figure className="ui-lesson-video">
      <figcaption>
        {video.title}
        {item?.importanceLabel && <> <span className="ui-badge">{item.importanceLabel}</span></>}
        {item?.done && <> <span className="ui-badge ui-badge--accent">Done</span></>}
      </figcaption>
      {item && !item.open && <p className="small muted">Not open yet. {reason ?? ""}</p>}
      <NeoVideo title={video.title} onPlay={() => void load()} loaded={!!src} busy={busy}>
        {src ? (
          // No autoplay: the learner presses play. The transcript below stands in for captions.
          <video controls preload="metadata" aria-describedby={transcriptId} onEnded={() => void ended()}>
            <source src={src.url} type={src.mime} />
          </video>
        ) : <span aria-hidden="true" />}
      </NeoVideo>
      {problem && <p role="status" className="small">{problem}</p>}
      {watched && <p role="status" className="small">{watched}</p>}
      <details className="ui-lesson-video__transcript" id={transcriptId}>
        <summary>Transcript</summary>
        <p>{video.transcript}</p>
      </details>
    </figure>
  );
}
