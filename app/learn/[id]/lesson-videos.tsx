"use client";

import { useId, useState } from "react";
import { call } from "../../call";
import { NeoVideo } from "../../ui/neo";
import { videoLinkFrom, type LessonVideo } from "../../studio-api";

/**
 * C1: the lesson's videos, made by the Owner. An approved video plays in the course UI kit's bezel through a link that
 * works for ten minutes; it never plays by itself, and its transcript is right below. A slot without an approved video
 * says "Video coming" in plain words, never a fake player.
 */
export function LessonVideos({ videos }: { videos: LessonVideo[] }) {
  if (!videos.length) return null;
  return (
    <section aria-label="Videos" className="ui-lesson-videos">
      {videos.map((v) => (v.state === "ready" ? <ReadyVideo key={v.id} video={v} /> : (
        <p key={v.id} className="ui-video-coming"><strong>{v.title}</strong>: Video coming.</p>
      )))}
    </section>
  );
}

function ReadyVideo({ video }: { video: LessonVideo }) {
  const [src, setSrc] = useState<{ url: string; mime: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const transcriptId = useId();
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
      <figcaption>{video.title}</figcaption>
      <NeoVideo title={video.title} onPlay={() => void load()} loaded={!!src} busy={busy}>
        {src ? (
          // No autoplay: the learner presses play. The transcript below stands in for captions.
          <video controls preload="metadata" aria-describedby={transcriptId}>
            <source src={src.url} type={src.mime} />
          </video>
        ) : <span aria-hidden="true" />}
      </NeoVideo>
      {problem && <p role="status" className="small">{problem}</p>}
      <details className="ui-lesson-video__transcript" id={transcriptId}>
        <summary>Transcript</summary>
        <p>{video.transcript}</p>
      </details>
    </figure>
  );
}
