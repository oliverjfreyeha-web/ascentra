"use client";

import { useCallback, useEffect, useState } from "react";
import { call } from "../../call";
import { LessonView } from "../../lesson-body";
import { MentorPanel } from "./mentor-panel";
import { ReadLine } from "./read-line";
import { Practice } from "./practice";
import { lessonActivitiesFrom, type LessonPractice } from "../../activities-api";
import { learnerLessonFrom, type LearnerLesson } from "../../courses-api";
import { Loading } from "../../ui/loading";
import { lessonVideosFrom, reviewLabel, type LessonVideo } from "../../studio-api";
import { LessonVideos } from "./lesson-videos";
import { lessonProgressFrom, type LessonProgress } from "../../progress-api";

/** L2: one published lesson, with its citations and "last verified" date. Progress records the version read. */
export function LessonReader({ id }: { id: string }) {
  const [current, setCurrent] = useState(false);
  const [data, setData] = useState<LearnerLesson | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [practice, setPractice] = useState<LessonPractice | null>(null);
  const [videos, setVideos] = useState<LessonVideo[]>([]);
  // C2: labels, open and done, and the course notices (each shown once: kept here until the page is left).
  const [extras, setExtras] = useState<LessonProgress | null>(null);
  const [notices, setNotices] = useState<LessonProgress["notices"]>([]);
  const url = `/api/v1/learn/lessons/${encodeURIComponent(id)}`;
  const load = useCallback(async () => {
    const r = await call("GET", current ? `${url}?view=current` : url);
    const l = r._status === 200 ? learnerLessonFrom(r) : null;
    setData(l);
    setPractice(r._status === 200 ? lessonActivitiesFrom(r) : null);
    setVideos(r._status === 200 ? lessonVideosFrom(r) : []);
    const x = r._status === 200 ? lessonProgressFrom(r.progress2) : null;
    setExtras(x);
    if (x?.notices.length) setNotices((n) => [...n, ...x.notices]);
    setFailed(l ? null : r.reason ?? "Couldn't load this lesson.");
  }, [url, current]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  if (failed) return <p role="status" className="ui-state ui-state--error">{failed}</p>;
  if (!data) return <Loading shape="lesson" />;
  const v = data.lesson.version;
  async function complete() {
    const r = await call("POST", `${url}/progress`, { versionId: v.id, status: "complete" });
    setMessage(r._status === 200 ? "Marked as done." : r.reason ?? "Couldn't save your progress.");
    await load();
  }
  const update = data.update;
  async function switchToUpdated() {
    if (!update) return;
    // Their progress is kept: a lesson they completed stays complete on the new version.
    const r = await call("POST", `${url}/progress`, { versionId: update.versionId, status: data!.progress?.status === "complete" ? "complete" : "in_progress", carry: true });
    setMessage(r._status === 200 ? "You're on the updated version. Your progress is kept." : r.reason ?? "Couldn't switch.");
    setCurrent(true);
  }
  return (
    <>
      <ReadLine />
      {update && (
        <div className="notice ui-lesson-update" role="status">
          <strong>Updated.</strong> A newer version of this lesson (v{update.number}, published {new Date(update.publishedAt).toLocaleDateString()}) is available.
          {update.summary ? ` ${update.summary}` : ""} You&apos;re reading the version you studied.{" "}
          <button type="button" onClick={() => void switchToUpdated()}>Switch to the updated version</button>
        </div>
      )}
      <header className="ui-lesson-head">
        <p className="ui-eyebrow">{data.lesson.course.name}</p>
        <h1>{data.lesson.title}</h1>
        <p className="ui-lesson-meta">
          <span>Version {v.number}, published {new Date(v.publishedAt).toLocaleDateString()}</span>
          <span aria-hidden="true">·</span>
          <span className="ui-verified">Last verified {v.lastVerifiedOn ?? "unknown"}</span>
          {/* C1: "Reviewed by the Owner" only with the Owner's recorded approval of this version. */}
          {data.lesson.review && (
            <>
              <span aria-hidden="true">·</span>
              <span>{reviewLabel(data.lesson.review)}</span>
            </>
          )}
        </p>
      </header>
      {notices.length > 0 && (
        <aside aria-label="Notices for this course" className="ui-lesson-notices">
          {notices.map((n) => (
            <p key={n.kind} className="notice" role="note"><strong>{n.kind === "license" ? "Business license" : "Software and AI plans"}:</strong> {n.text} <span className="small muted">General information, not legal advice. Not sponsored. Shown once per course.</span></p>
          ))}
        </aside>
      )}
      {extras && (
        <p className="small muted">Module {extras.module.position}: {extras.module.doneCount} of {extras.module.itemCount} items done · rank {extras.rank.name}</p>
      )}
      <LessonVideos videos={videos} progress={extras} onWatched={() => void load()} />
      <LessonView body={v.body} citations={v.citations} lastVerifiedOn={v.lastVerifiedOn} uncited={v.uncited} />
      <div className="ui-lesson-end">
        {data.progress?.status === "complete"
          ? <p className="ui-done">Done.</p>
          : <button type="button" className="primary" onClick={() => void complete()}>Mark as done</button>}
        {message && <p role="status">{message}</p>}
      </div>
      {practice && <Practice items={practice.activities} score={practice.score} selection={practice.selection} onScore={(score) => setPractice({ ...practice, score })} onModeChanged={() => void load()}
        progress={extras} onProgress={() => void load()} />}
      <MentorPanel lessonId={id} />
    </>
  );
}
